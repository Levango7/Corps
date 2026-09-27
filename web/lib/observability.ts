/**
 * 错误上报（零依赖）— lib/observability.ts
 *
 * 背景：项目已有结构化日志（lib/logger.ts）与错误边界（app/global-error.tsx），
 * 但错误只写入 stdout，缺少**远端上报与告警**——线上 500、前端白屏只能靠人工翻
 * 日志才能发现。本模块补上该缺口。
 *
 * 依赖原则：遵循 lib/logger.ts 的既定方针 —— **零依赖**。不引入 @sentry/nextjs
 * 等 SDK（其携带 rollup 等十余个构建期依赖，与"避免 bundle 膨胀"的项目约定冲突）。
 * 需要 Sentry 时走其公开的 Envelope HTTP API 直传，无需 SDK。
 *
 * 设计：
 * - 多 sink、配置驱动、默认降级：
 *     · 始终写结构化日志（logger.error，保留现有可观测基线）
 *     · SENTRY_DSN 配置时 → Sentry Envelope API 直传
 *     · ERROR_WEBHOOK_URL 配置时 → POST JSON（适配飞书/企业微信/Slack/自建告警）
 *     · 两者都未配置 → 仅本地日志，**零网络开销**
 * - 脱敏：递归剔除 password/token/secret/cookie/authorization 等敏感键
 * - 防风暴：按 sink 每分钟限流（默认 30 条），超出丢弃并计数，避免错误风暴打爆下游
 * - fire-and-forget：不 await、3s 超时、任何失败只降级为本地日志，绝不影响业务请求
 */

import { logger } from "./logger";

/** 上报上下文（任意附加信息，敏感键会被脱敏） */
export interface ErrorContext {
  [key: string]: unknown;
}

type Sink = "sentry" | "webhook";

/** 需要脱敏的键名（小写包含匹配） */
const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "credential",
  "session",
  "privatekey",
  "private_key",
];

/** 脱敏占位符 */
const REDACTED = "[REDACTED]";

/** 递归深度上限，防止循环引用/超深对象 */
const MAX_DEPTH = 4;

/** 单 sink 每分钟上报上限（防错误风暴） */
const RATE_LIMIT_PER_MINUTE = 30;

/** 上报请求超时（毫秒） */
const UPLOAD_TIMEOUT_MS = 3_000;

interface RateBucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<Sink, RateBucket>();

/**
 * 判断是否允许本次上报（简易固定窗口限流）。
 * 超限返回 false，并由调用方丢弃——错误风暴时宁可丢上报也不拖垮下游。
 */
function allow(sink: Sink): boolean {
  const now = Date.now();
  const bucket = buckets.get(sink);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    buckets.set(sink, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_PER_MINUTE) return false;
  bucket.count += 1;
  return true;
}

/** 测试辅助：重置限流窗口（仅测试使用） */
export function __resetRateLimit(): void {
  buckets.clear();
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((k) => lower.includes(k));
}

/**
 * 递归脱敏：剔除敏感键、截断超长字符串、限制深度。
 * 对 Error 实例转为可序列化对象（message/name/stack）。
 */
function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[TRUNCATED_DEPTH]";

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.length > 2_000 ? value.slice(0, 2_000) + "…[TRUNCATED]" : value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[FUNCTION]";
  return value;
}

/** 把任意抛出物规范为 Error（catch 可能捕获到字符串/对象） */
export function toError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  if (typeof thrown === "string") return new Error(thrown);
  try {
    return new Error(JSON.stringify(thrown));
  } catch {
    return new Error(String(thrown));
  }
}

// ─── Sentry sink（Envelope HTTP API，无需 SDK）───────────────────────────────

/** 解析 Sentry DSN：https://{publicKey}@{host}/{projectId} */
function parseDsn(dsn: string): { endpoint: string; publicKey: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return null;
    return {
      publicKey,
      projectId,
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

/** 生成 Sentry event_id（32 位十六进制，无横线） */
function eventId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 经 Sentry Envelope API 上报。
 *
 * Envelope 为换行分隔的三段式：信封头 / 条目头 / 条目体。
 * 采用 `platform: "javascript"` + `exception.values[0]`（含 stack）让 Sentry
 * 自动聚合同类错误；无 stack 时 Sentry 仍按 message 聚合。
 */
async function sendToSentry(
  err: Error,
  context: ErrorContext,
  tags: Record<string, string>,
): Promise<void> {
  // 服务端用 SENTRY_DSN；浏览器端用 NEXT_PUBLIC_SENTRY_DSN（Sentry 的 public key
  // 设计上可安全暴露于客户端；非 NEXT_PUBLIC 前缀的变量在客户端恒为 undefined，
  // 自动降级为仅本地日志）。
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) {
    logger.warn("invalid SENTRY_DSN, sentry sink disabled");
    return;
  }
  if (!allow("sentry")) return;

  const id = eventId();
  const envelopeHeader = JSON.stringify({
    event_id: id,
    dsn,
    sent_at: new Date().toISOString(),
  });
  const itemHeader = JSON.stringify({ type: "event", content_type: "application/json" });
  const payload = JSON.stringify({
    event_id: id,
    timestamp: Date.now() / 1000,
    level: "error",
    platform: "javascript",
    logger: "corps-web",
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    exception: {
      values: [{ type: err.name, value: err.message, stacktrace: err.stack ? { raw: err.stack } : undefined }],
    },
    tags,
    extra: redact(context) as Record<string, unknown>,
  });

  await post(parsed.endpoint, `${envelopeHeader}\n${itemHeader}\n${payload}`, {
    "Content-Type": "application/x-sentry-envelope",
    "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=corps-web/1.0, sentry_key=${parsed.publicKey}`,
  });
}

// ─── Webhook sink（飞书/企微/Slack/自建告警通用）──────────────────────────────

/**
 * POST 一个通用 JSON 到告警 webhook。
 * body 结构刻意保持中立（text + 结构化字段），便于接收端自行取舍：
 * 飞书/企微/Slack 的自定义机器人均可通过其模板字段消费 text。
 */
async function sendToWebhook(
  err: Error,
  context: ErrorContext,
  tags: Record<string, string>,
): Promise<void> {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  if (!allow("webhook")) return;

  const title = `[corps] ${err.name}: ${err.message}`;
  const body = JSON.stringify({
    // text 字段兼容飞书/企微/Slack 自定义机器人的通用文本消费
    text: `${title}\n${tags.source ?? ""} ${tags.route ?? ""}`.trim(),
    level: "error",
    name: err.name,
    message: err.message,
    stack: err.stack,
    tags,
    extra: redact(context),
    timestamp: new Date().toISOString(),
  });

  await post(url, body, { "Content-Type": "application/json" });
}

/** 带超时的 POST；任何失败都降级为本地日志，不向上抛。 */
async function post(url: string, body: string, headers: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    if (!res.ok) {
      logger.warn("observability upload rejected", { url: redactUrl(url), status: res.status });
    }
  } catch (e) {
    // 上报失败不能影响业务：仅本地记录一次（不再递归上报）
    logger.warn("observability upload failed", { url: redactUrl(url), err: toError(e).message });
  } finally {
    clearTimeout(timer);
  }
}

/** 隐藏 URL 中的凭据/查询串（DSN 的 publicKey 在 userinfo 中） */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────

/**
 * 上报一个错误：写结构化日志，并按配置分发到远端 sink。
 *
 * **同步返回**（fire-and-forget）：远端上报在后台进行，调用方无需 await，
 * 也不会因上报失败而受影响。适合在 catch 块、错误边界、全局处理器中直接调用。
 *
 * @param thrown - catch 到的任意抛出物（Error / string / 其它）
 * @param context - 附加上下文（敏感键自动脱敏），约定包含 `source`
 *
 * @example
 * ```ts
 * try {
 *   await doWork();
 * } catch (e) {
 *   captureError(e, { source: "route", route: "/api/v1/tasks" });
 *   throw e;
 * }
 * ```
 */
export function captureError(thrown: unknown, context: ErrorContext = {}): void {
  const err = toError(thrown);
  const tags: Record<string, string> = {
    source: String(context.source ?? "unknown"),
  };
  if (typeof context.route === "string") tags.route = context.route;

  // 1) 本地结构化日志（始终执行，保留既有可观测基线）
  const safe = redact(context) as Record<string, unknown>;
  logger.error(`${err.name}: ${err.message}`, { ...safe, stack: err.stack });

  // 2) 远端 sink（未配置时立即 return，零网络开销）
  void sendToSentry(err, context, tags);
  void sendToWebhook(err, context, tags);
}

/** 当前是否启用了任一远端 sink（供启动日志/自检使用） */
export function isRemoteReportingEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN || process.env.ERROR_WEBHOOK_URL);
}

/** uncaughtException 后留给上报的窗口（毫秒），到期按 Node 原语义退出 */
const UNCAUGHT_EXIT_DELAY_MS = 500;

/**
 * 注册进程级未处理异常捕获（供 instrumentation.ts 在 Node 运行时调用）。
 *
 * 语义说明：
 * - `unhandledRejection`：仅上报，不改变进程行为。
 * - `uncaughtException`：上报后**延时退出**（而非静默继续）。原因：抛出未捕获
 *   异常后进程状态已不可信，继续提供服务可能写入错误数据；延时 500ms 是给
 *   fire-and-forget 的上报请求留出送达窗口。退出后由容器编排（restart policy）
 *   重启 —— 与 instrumentation.ts 中"生产环境环境变量校验失败即 exit(1)"的
 *   fail-fast 方针一致。
 *
 * 幂等：重复调用不会重复注册（以模块级标记位保证）。
 */
let handlersInstalled = false;

export function installProcessErrorHandlers(): void {
  if (handlersInstalled) return;
  if (typeof process === "undefined" || typeof process.on !== "function") return;
  handlersInstalled = true;

  process.on("unhandledRejection", (reason) => {
    captureError(reason, { source: "unhandledRejection" });
  });

  process.on("uncaughtException", (error) => {
    captureError(error, { source: "uncaughtException" });
    setTimeout(() => process.exit(1), UNCAUGHT_EXIT_DELAY_MS).unref();
  });

  logger.info("process error handlers installed", {
    remoteReporting: isRemoteReportingEnabled(),
  });
}

/** 测试辅助：重置注册标记（仅测试使用） */
export function __resetHandlersFlag(): void {
  handlersInstalled = false;
}


