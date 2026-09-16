/**
 * 结构化日志工具 — 生产环境输出 JSON 格式，开发环境输出可读格式
 *
 * 设计原则：
 * - 零依赖（不引入 pino/winston，避免 bundle 膨胀）
 * - 生产 JSON 格式便于日志聚合（ELK/Loki/Datadog）
 * - 开发可读格式便于调试
 * - 支持 requestId 关联同一请求的多条日志
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

interface LogContext {
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const isProduction = process.env.NODE_ENV === "production";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatLog(level: LogLevel, msg: string, ctx?: LogContext, requestId?: string): string {
  const timestamp = new Date().toISOString();

  if (isProduction) {
    // 生产：JSON 格式（单行，便于日志聚合）
    return JSON.stringify({
      ts: timestamp,
      level,
      msg,
      ...(requestId ? { reqId: requestId } : {}),
      ...(ctx ? { ctx } : {}),
    });
  }

  // 开发：可读格式
  const ctxStr = ctx ? ` ${JSON.stringify(ctx)}` : "";
  const reqStr = requestId ? ` [${requestId.slice(0, 8)}]` : "";
  return `[${timestamp}] ${level.toUpperCase()}${reqStr} ${msg}${ctxStr}`;
}

export const logger = {
  debug: (msg: string, ctx?: LogContext, requestId?: string) => {
    if (shouldLog("debug")) console.debug(formatLog("debug", msg, ctx, requestId));
  },
  info: (msg: string, ctx?: LogContext, requestId?: string) => {
    if (shouldLog("info")) console.info(formatLog("info", msg, ctx, requestId));
  },
  warn: (msg: string, ctx?: LogContext, requestId?: string) => {
    if (shouldLog("warn")) console.warn(formatLog("warn", msg, ctx, requestId));
  },
  error: (msg: string, ctx?: LogContext, requestId?: string) => {
    if (shouldLog("error")) console.error(formatLog("error", msg, ctx, requestId));
  },
  fatal: (msg: string, ctx?: LogContext, requestId?: string) => {
    if (shouldLog("fatal")) console.error(formatLog("fatal", msg, ctx, requestId));
  },
};

/**
 * 生成请求 ID（用于关联同一请求的多条日志）
 * 使用 crypto.randomUUID()（Node.js 19+ 内置）
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}