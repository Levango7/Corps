/**
 * AI SDK v7 UI Message Stream 消费工具。
 *
 * 后端用 `result.toUIMessageStreamResponse()` 输出标准 SSE
 * （每条事件形如 `data: {json}\n\n`），json 含 `type` 字段；
 * 文本增量位于 `type: "text-delta"` 的 `textDelta` 字段。
 *
 * 设计决策：项目当前未安装 `@ai-sdk/react`（`useCompletion` hook 所在包），
 * 为避免引入新依赖、改动 package.json/lockfile，这里用原生 fetch +
 * ReadableStream 解析 SSE 协议。类型安全、零外部依赖、完全可控。
 */

export interface ConsumeAiStreamOptions {
  /** 文本增量回调（每收到一个 text-delta 触发，用于实时渲染） */
  onDelta?: (delta: string) => void;
  /** 中止信号 */
  signal?: AbortSignal;
}

/**
 * 发起 AI 流式 POST 请求并累加文本增量，返回完整文本。
 *
 * @param url API 端点（如 `/api/v1/ai/completion`）
 * @param body 请求体对象
 * @param options onDelta 回调与 AbortSignal
 * @returns 流式累加后的完整文本
 * @throws 当 HTTP 状态非 2xx、响应无 body、或被 abort 时抛出
 */
export async function consumeAiStream(
  url: string,
  body: Record<string, unknown>,
  options?: ConsumeAiStreamOptions,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!res.ok) {
    throw new Error(`AI request failed: HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error("AI response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 事件以空行（\n\n）分隔；逐事件解析
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const obj = JSON.parse(payload) as { type?: string; textDelta?: string };
          if (obj.type === "text-delta" && typeof obj.textDelta === "string") {
            full += obj.textDelta;
            options?.onDelta?.(obj.textDelta);
          }
        } catch {
          // 非 JSON 行（如注释/心跳）忽略
        }
      }
    }
  }

  return full;
}