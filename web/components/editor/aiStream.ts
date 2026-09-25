/**
 * AI SDK v7 UI Message Stream 消费工具。
 *
 * 后端用 `result.toUIMessageStreamResponse()` 或 `createUIMessageStreamResponse()`
 * 输出标准 SSE（每条事件形如 `data: {json}\n\n`），json 含 `type` 字段；
 * 文本增量位于 `type: "text-delta"` 的 `textDelta` 字段。
 *
 * 设计决策：项目当前未安装 `@ai-sdk/react`（`useCompletion` hook 所在包），
 * 为避免引入新依赖、改动 package.json/lockfile，这里用原生 fetch +
 * ReadableStream 解析 SSE 协议。类型安全、零外部依赖、完全可控。
 *
 * 提供两个消费函数：
 *  - `consumeAiStream`：仅消费文本增量（text-delta）
 *  - `consumeAiProgressStream`：消费文本增量 + 进度 data part + 结果 data part + error part
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

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // 统一换行：将 \r\n 归一化为 \n，使 SSE 事件分隔 \n\n 同时兼容 \r\n\r\n
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

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
  } finally {
    // 释放 reader 锁，避免资源泄漏（abort 后 releaseLock 可能抛异常，安全忽略）
    try {
      reader.releaseLock();
    } catch {
      // reader 已被 cancel/abort，忽略
    }
  }

  return full;
}

// —— 进度流消费 ——

/** 进度 data part 数据结构（与后端 AiProgressData 一致） */
export interface AiProgressPart {
  /** 阶段编号：1=聚合数据, 2=分析, 3=生成 */
  stage: 1 | 2 | 3;
  /** 阶段描述消息 */
  message: string;
}

/** consumeAiProgressStream 的选项 */
export interface ConsumeAiProgressStreamOptions {
  /** 文本增量回调（每收到一个 text-delta 触发，用于实时渲染） */
  onDelta?: (delta: string) => void;
  /** 进度回调（每收到一个 data-progress part 触发） */
  onProgress?: (progress: AiProgressPart) => void;
  /** 结果回调（收到 data-result part 触发，用于结构化 JSON 输出） */
  onData?: (data: unknown) => void;
  /** 中止信号 */
  signal?: AbortSignal;
}

/** consumeAiProgressStream 的返回值 */
export interface ConsumeAiProgressStreamResult {
  /** 流式累加后的完整文本（文本流模式下有值） */
  text: string;
  /** 结果 data part 的 data（JSON 流模式下有值，文本流模式下为 undefined） */
  data: unknown;
}

/**
 * 发起 AI 流式 POST 请求，消费文本增量 + 进度 data part + 结果 data part。
 *
 * 解析 SSE 流中的以下 part 类型：
 *  - `text-delta`：文本增量，触发 onDelta 回调
 *  - `data-progress`：进度 data part，触发 onProgress 回调
 *  - `data-result`：结果 data part，触发 onData 回调
 *  - `error`：错误 part，抛异常（errorText 作为异常消息）
 *
 * @param url API 端点
 * @param body 请求体对象
 * @param options onDelta/onProgress/onData 回调与 AbortSignal
 * @returns { text, data } — 文本流模式下 text 有值，JSON 流模式下 data 有值
 * @throws 当 HTTP 状态非 2xx、收到 error part、或被 abort 时抛出
 */
export async function consumeAiProgressStream(
  url: string,
  body: Record<string, unknown>,
  options?: ConsumeAiProgressStreamOptions,
): Promise<ConsumeAiProgressStreamResult> {
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
  let text = "";
  let data: unknown;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // 统一换行：将 \r\n 归一化为 \n，使 SSE 事件分隔 \n\n 同时兼容 \r\n\r\n
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      // SSE 事件以空行（\n\n）分隔；逐事件解析
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;

          // 先解析 JSON，解析失败则忽略（非 JSON 行如注释/心跳）
          let obj: {
            type?: string;
            textDelta?: string;
            data?: unknown;
            errorText?: string;
          };
          try {
            obj = JSON.parse(payload);
          } catch {
            continue;
          }

          switch (obj.type) {
            case "text-delta":
              if (typeof obj.textDelta === "string") {
                text += obj.textDelta;
                options?.onDelta?.(obj.textDelta);
              }
              break;
            case "data-progress":
              if (obj.data && typeof obj.data === "object") {
                const progress = obj.data as AiProgressPart;
                if (typeof progress.stage === "number" && typeof progress.message === "string") {
                  options?.onProgress?.(progress);
                }
              }
              break;
            case "data-result":
              data = obj.data;
              options?.onData?.(obj.data);
              break;
            case "error":
              // 流错误 part：抛异常让前端 catch 块处理
              throw new Error(obj.errorText ?? "AI stream error");
          }
        }
      }
    }
  } finally {
    // 释放 reader 锁，避免资源泄漏（abort 后 releaseLock 可能抛异常，安全忽略）
    try {
      reader.releaseLock();
    } catch {
      // reader 已被 cancel/abort，忽略
    }
  }

  return { text, data };
}
