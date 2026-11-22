/**
 * nexusloom sidecar 的日报运行时 adapter。
 *
 * 只替换「模型执行段」，不替代 Corps 的登录、workspace/RLS、反馈样例、配额断言与
 * 流式响应契约。输出仍走 UI message stream：阶段 1/2/3 与 text-delta。
 *
 * 请求面刻意很窄：operator 配置的 baseUrl → POST /api/tasks（wait=true）→
 * output_content。没有用户可控 URL、没有任意路径写入、没有自动业务落库。
 */
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { isIP } from "node:net";
import type { AiProgressStages } from "@/lib/ai/stream";
import { fireRecordUsage, type UsageTrackingParams } from "@/lib/ai/usage-middleware";

export interface LoomDailyReportParams {
  /** operator 配置的 nexusloom Admin API 根地址（必须公网 http/https） */
  baseUrl: string;
  /** 可选 Admin API key；非回环部署必须配置 */
  apiKey?: string;
  /** 与现有日报相同的 system prompt */
  system: string;
  /** 现有聚合上下文函数（阶段 1 后执行） */
  buildPrompt: () => Promise<string>;
  /** 文档标题 */
  title: string;
  stages: AiProgressStages;
  usageTracking?: UsageTrackingParams;
}

function writeProgress(
  writer: { write(part: UIMessageChunk): void },
  stage: 1 | 2 | 3,
  message: string,
): void {
  writer.write({ type: "data-progress", data: { stage, message } } as UIMessageChunk);
}

function isPrivateIp(hostname: string): boolean {
  const ip = hostname.toLowerCase();
  if (ip === "0.0.0.0" || ip === "::" || ip === "::1") return true;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.") || ip.startsWith("224.") || ip.startsWith("240.")) return true;
  if (ip.startsWith("192.0.2.") || ip.startsWith("198.51.100.") || ip.startsWith("203.0.113.")) {
    return true;
  }
  if (ip.startsWith("172.")) {
    const n = Number(ip.split(".")[1]);
    return Number.isInteger(n) && n >= 16 && n <= 31;
  }
  if (
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe8") ||
    ip.startsWith("fe9") ||
    ip.startsWith("fea") ||
    ip.startsWith("feb")
  ) {
    return true;
  }
  return false;
}

/** 只允许公网 http/https，拒绝环回、私有、保留地址与内嵌凭证。 */
export function assertLoomRuntimeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LOOM_RUNTIME_URL 不是合法 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LOOM_RUNTIME_URL 只允许 http/https");
  }
  if (url.username || url.password) {
    throw new Error("LOOM_RUNTIME_URL 不允许内嵌用户名或密码");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "ip6-localhost" ||
    host === "0" ||
    isPrivateIp(host) ||
    (isIP(host) === 0 && !host.includes("."))
  ) {
    throw new Error("LOOM_RUNTIME_URL 拒绝 localhost、环回、私有或保留地址");
  }
  return url.toString().replace(/\/$/, "");
}

export function createLoomDailyReportStream(params: LoomDailyReportParams): Response {
  const baseUrl = assertLoomRuntimeUrl(params.baseUrl);
  const usageStartTime = params.usageTracking ? Date.now() : 0;

  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      writeProgress(writer, 1, params.stages.context);
      const userPrompt = await params.buildPrompt();
      writeProgress(writer, 2, params.stages.analyzing);
      writeProgress(writer, 3, params.stages.generating);

      const headers: Record<string, string> = { "content-type": "application/json" };
      if (params.apiKey) headers.authorization = `Bearer ${params.apiKey}`;

      try {
        const response = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: `${params.system}\n\n${userPrompt}`,
            title: params.title,
            pipeline: "office-daily-report",
            wait: true,
          }),
          signal: AbortSignal.timeout(120_000),
        });
        const payload = (await response.json()) as {
          output_content?: unknown;
          error?: unknown;
        };
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string" && payload.error
              ? payload.error
              : `nexusloom 返回 HTTP ${response.status}`,
          );
        }
        if (typeof payload.output_content !== "string" || !payload.output_content.trim()) {
          throw new Error("nexusloom 未返回 output_content");
        }
        writer.write({
          type: "text-delta",
          delta: payload.output_content,
        } as UIMessageChunk);
        if (params.usageTracking) {
          fireRecordUsage(params.usageTracking, usageStartTime, undefined, true);
        }
      } catch (error) {
        if (params.usageTracking) {
          fireRecordUsage(params.usageTracking, usageStartTime, undefined, false);
        }
        throw error;
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
