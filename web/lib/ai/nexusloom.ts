/**
 * nexusloom Admin API 客户端封装（sidecar 交付运行时）。
 *
 * nexusloom 是自托管 Python 交付运行时：DAG 编排 + 产出契约 + 审批闸门 +
 * 交付账本 + LLM 预算熔断。corps 通过其 Admin API（默认 127.0.0.1:8910，
 * docker compose 常驻）提交文档生成等交付任务并轮询进度——DAG 藏在 sidecar
 * 内部（"不可见运行时"定位），corps 无用户可见 DAG，只透出阶段进度。
 *
 * 契约（loom_core/admin_api.py，零外部依赖 REST）：
 *   POST /api/tasks   { query|inputs, title?, pipeline?(默认 docgen), wait?, output? }
 *   GET  /tasks       → { tasks: [{ id, status, pipeline, created_at, finished_at, error }], count }
 *   GET  /tasks/<id>  → { id, status, pipeline, result, output_path, output_content, created_at, finished_at }
 *   GET  /api/deliveries?limit=N → 交付账本（finished_at 降序）
 *
 * 归属语义（第一竖切）：sidecar 部署在本机回环、corps 是唯一调用方，
 * 列表全量透传；详情/取件按 title 前缀编码校验工作区归属。多租户隔离
 * （named-token principal 或 webhook 回写落库）留第二竖切。
 */

/** 服务端点：部署者可经 env 覆盖，但只允许指向**回环或私有网段**——
 * 该客户端只应该与本机 sidecar 通信，不允许被配置成打公网/元数据端点。
 * 非法 host fail-closed 退回默认回环端点，而不是照打。 */
function resolveLoomBase(): string {
  const raw = (process.env.NEXUSLOOM_URL ?? "http://127.0.0.1:8910").replace(/\/+$/, "");
  if (
    !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      raw,
    )
  ) {
    return "http://127.0.0.1:8910";
  }
  return raw;
}

const LOOM_KEY = process.env.NEXUSLOOM_API_KEY ?? "";
/** sidecar 健康时响应亚秒级；提交是长任务入队，给足超时 */
const TIMEOUT_MS = 15_000;

/** 任务 id 白名单（Admin API 生成的受限字符集；阻断路径拼接注入） */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** sidecar 不可达/参数非法的统一异常（路由层据此返回 502 + 明确文案） */
export class LoomUnavailableError extends Error {
  constructor(detail: string) {
    super(`nexusloom sidecar unavailable: ${detail}`);
    this.name = "LoomUnavailableError";
  }
}

export function assertSafeLoomId(id: string): string {
  if (!SAFE_ID_RE.test(id)) {
    throw new LoomUnavailableError("invalid task id shape");
  }
  return id;
}

/** corps 提交时写入 title 的归属前缀（详情/取件时校验，防跨工作区读取） */
export function loomTitlePrefix(wid: string): string {
  return `[loom:${wid}] `;
}

export function encodeLoomTitle(wid: string, title: string): string {
  return `${loomTitlePrefix(wid)}${title}`.slice(0, 200);
}

export function decodeLoomTitle(full: string | undefined | null): {
  wid: string | null;
  title: string;
} {
  const t = full ?? "";
  const m = t.match(/^\[loom:([0-9a-f-]{36})\] (.*)$/s);
  if (!m) return { wid: null, title: t };
  return { wid: m[1], title: m[2] };
}

function loomHeaders(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (LOOM_KEY) h.Authorization = `Bearer ${LOOM_KEY}`;
  return h;
}

async function loomFetch(path: string, init?: RequestInit): Promise<unknown> {
  const base = resolveLoomBase();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...loomHeaders(), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new LoomUnavailableError(`HTTP ${res.status} ${path} ${text.slice(0, 120)}`);
  }
  return res.json();
}

export interface LoomTaskSummary {
  id: string;
  status: string;
  pipeline: string;
  created_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface LoomTaskDetail extends LoomTaskSummary {
  result: Record<string, unknown>;
  output_path: string | null;
  output_content: string | null;
}

/** 提交交付任务。返回 nexusloom 的入队响应（含任务 id）。 */
export async function submitLoomTask(body: {
  query: string;
  title?: string;
  pipeline?: string;
}): Promise<Record<string, unknown>> {
  try {
    return (await loomFetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        query: body.query,
        ...(body.title ? { title: body.title } : {}),
        ...(body.pipeline ? { pipeline: body.pipeline } : {}),
        wait: false,
      }),
    })) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof LoomUnavailableError) throw e;
    throw new LoomUnavailableError(String(e));
  }
}

/** 任务列表（全量透传；本机 sidecar 语义）。 */
export async function listLoomTasks(): Promise<LoomTaskSummary[]> {
  try {
    const data = (await loomFetch("/tasks")) as { tasks?: LoomTaskSummary[] };
    return data.tasks ?? [];
  } catch (e) {
    if (e instanceof LoomUnavailableError) throw e;
    throw new LoomUnavailableError(String(e));
  }
}

/** 任务详情（含输出内容与产出路径）。 */
export async function getLoomTask(id: string): Promise<LoomTaskDetail> {
  assertSafeLoomId(id);
  try {
    return (await loomFetch(`/tasks/${id}`)) as LoomTaskDetail;
  } catch (e) {
    if (e instanceof LoomUnavailableError) throw e;
    throw new LoomUnavailableError(String(e));
  }
}

/** sidecar 是否可达（供配置探测与就绪提示）。 */
export async function loomHealthy(): Promise<boolean> {
  try {
    await loomFetch("/health");
    return true;
  } catch {
    return false;
  }
}

/**
 * 拉取交付物文件流（交付账本 download 端点，attachment）。
 * 返回上游 Response——调用方透传 body/headers 回浏览器；
 * 账本行在但文件已不在时上游回 404（语义=没有可下载的东西）。
 */
export async function fetchLoomDeliveryDownload(taskId: string): Promise<Response> {
  assertSafeLoomId(taskId);
  try {
    const base = resolveLoomBase();
    const res = await fetch(`${base}/api/deliveries/${taskId}/download`, {
      headers: { ...(LOOM_KEY ? { Authorization: `Bearer ${LOOM_KEY}` } : {}) },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new LoomUnavailableError(`HTTP ${res.status} download`);
    }
    return res;
  } catch (e) {
    if (e instanceof LoomUnavailableError) throw e;
    throw new LoomUnavailableError(String(e));
  }
}
