// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AI 进度流契约（lib/ai/stream.ts）：
 *  - 阶段化进度时序：data-progress 1（聚合）→ buildPrompt → 2（分析）→ 3（生成）→ LLM
 *  - 文本流模式：progress 之后 merge LLM 流；失败路径带 `[ai-stream] ...` 前缀抛错
 *  - JSON 模式：generateText 后写 data-result（结构化结果）；usage 成功/失败都记
 *  - usageTracking 仅在传入时生效（缺省不记录）
 *
 * 依赖面全 mock：`ai` 包的三个工厂 + usage-middleware 的 fireRecordUsage。
 * createUIMessageStream 的 mock 直接跑 execute 并把 writer.write 收到的 part 收进数组。
 */

const h = vi.hoisted(() => ({
  parts: [] as unknown[],
  merges: [] as unknown[],
  execute: undefined as undefined | (() => Promise<void>),
  streamText: vi.fn(),
  generateText: vi.fn(),
  fireRecordUsage: vi.fn(),
}));

vi.mock("ai", () => ({
  createUIMessageStream: vi.fn((opts: { execute: (a: { writer: unknown }) => Promise<void> }) => {
    const writer = {
      write: (part: unknown) => h.parts.push(part),
      merge: (s: unknown) => {
        h.merges.push(s);
        return Promise.resolve();
      },
    };
    // 工厂返回的响应体拿不到 execute —— 把 execute 捕获到 hoisted 容器，由 runStream() 驱动
    h.execute = () => opts.execute({ writer });
    return { __mock: true };
  }),
  createUIMessageStreamResponse: vi.fn(() => new Response("sse-body")),
  streamText: h.streamText,
  generateText: h.generateText,
}));

vi.mock("@/lib/ai/usage-middleware", () => ({
  fireRecordUsage: h.fireRecordUsage,
  type: undefined,
}));

import { createAiJsonProgressStream, createAiProgressStream } from "@/lib/ai/stream";

const STAGES = { context: "ctx", analyzing: "an", generating: "gen" };
const model = { modelId: "test-model" } as never;

async function runStream() {
  await h.execute!();
}

beforeEach(() => {
  h.parts.length = 0;
  h.merges.length = 0;
  h.execute = undefined;
  h.streamText.mockReset();
  h.generateText.mockReset();
  h.fireRecordUsage.mockReset();
});

describe("createAiProgressStream（文本流模式）", () => {
  it("进度顺序 1→2→3，且 buildPrompt 在 1 与 2 之间执行；随后 merge LLM 流", async () => {
    const order: string[] = [];
    h.streamText.mockReturnValue({ toUIMessageStream: () => "llm-stream" });
    const resp = createAiProgressStream(
      {
        model,
        system: "sys",
        buildPrompt: async () => {
          order.push("buildPrompt");
          return "prompt-text";
        },
      },
      STAGES,
    );
    // 捕获进度 part 的写入时序（parts 与 merge 分开记）
    await runStream();
    expect(h.parts).toEqual([
      { type: "data-progress", data: { stage: 1, message: "ctx" } },
      { type: "data-progress", data: { stage: 2, message: "an" } },
      { type: "data-progress", data: { stage: 3, message: "gen" } },
    ]);
    expect(order).toEqual(["buildPrompt"]);
    expect(h.streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model, system: "sys", prompt: "prompt-text" }),
    );
    expect(h.merges).toEqual(["llm-stream"]);
    expect(resp).toBeInstanceOf(Response);
  });

  it("buildPrompt 失败：抛带上下文的错误（[ai-stream] buildPrompt 失败）", async () => {
    createAiProgressStream(
      {
        model,
        system: "s",
        buildPrompt: async () => {
          throw new Error("db exploded");
        },
      },
      STAGES,
    );
    await expect(runStream()).rejects.toThrow(/\[ai-stream\] buildPrompt 失败: db exploded/);
    expect(h.streamText).not.toHaveBeenCalled();
  });

  it("streamText 失败：抛错且 usage 记失败（仅当传了 usageTracking）", async () => {
    h.streamText.mockImplementation(() => {
      throw new Error("model unavailable");
    });
    const tracking = { workspaceId: "w1", userId: "u1", capability: "x" } as never;
    createAiProgressStream(
      { model, system: "s", buildPrompt: async () => "p", usageTracking: tracking },
      STAGES,
    );
    await expect(runStream()).rejects.toThrow(/\[ai-stream\] streamText 初始化失败/);
    expect(h.fireRecordUsage).toHaveBeenCalledWith(tracking, expect.any(Number), undefined, false);
  });

  it("streamText 的 onFinish：触发 fireRecordUsage（成功路径）", async () => {
    let captured: ((a: { usage: unknown }) => void) | undefined;
    h.streamText.mockImplementation((args: { onFinish?: never }) => {
      captured = args.onFinish as never;
      return { toUIMessageStream: () => "s" };
    });
    const tracking = { workspaceId: "w1", userId: "u1", capability: "x" } as never;
    createAiProgressStream(
      { model, system: "s", buildPrompt: async () => "p", usageTracking: tracking },
      STAGES,
    );
    await runStream();
    expect(captured).toBeTypeOf("function");
    captured!({ usage: { inputTokens: 1, outputTokens: 2 } });
    expect(h.fireRecordUsage).toHaveBeenCalledWith(tracking, expect.any(Number), {
      inputTokens: 1,
      outputTokens: 2,
    });
  });
});

describe("createAiJsonProgressStream（JSON 结果模式）", () => {
  it("进度 1→2→3 后写 data-result（parseResult 的结构化结果）", async () => {
    h.generateText.mockResolvedValue({
      text: '{"risk":"low"}',
      usage: { inputTokens: 3, outputTokens: 4 },
    });
    createAiJsonProgressStream<{ risk: string }>(
      { model, system: "s", buildPrompt: async () => "p", parseResult: (t) => JSON.parse(t) },
      STAGES,
    );
    await runStream();
    expect(h.parts).toEqual([
      { type: "data-progress", data: { stage: 1, message: "ctx" } },
      { type: "data-progress", data: { stage: 2, message: "an" } },
      { type: "data-progress", data: { stage: 3, message: "gen" } },
      { type: "data-result", data: { risk: "low" } },
    ]);
    expect(h.merges).toEqual([]); // JSON 模式不 merge LLM 流
  });

  it("usageTracking：generateText 成功后记录 input/output tokens", async () => {
    h.generateText.mockResolvedValue({
      text: "{}",
      usage: { inputTokens: 5, outputTokens: 6 },
    });
    const tracking = { workspaceId: "w1", userId: "u1", capability: "y" } as never;
    createAiJsonProgressStream(
      {
        model,
        system: "s",
        buildPrompt: async () => "p",
        parseResult: () => ({}),
        usageTracking: tracking,
      },
      STAGES,
    );
    await runStream();
    expect(h.fireRecordUsage).toHaveBeenCalledWith(tracking, expect.any(Number), {
      inputTokens: 5,
      outputTokens: 6,
    });
  });

  it("generateText 失败：usage 记失败 + 抛 [ai-stream] generateText 失败", async () => {
    h.generateText.mockRejectedValue(new Error("timeout"));
    const tracking = { workspaceId: "w1", userId: "u1", capability: "y" } as never;
    createAiJsonProgressStream(
      {
        model,
        system: "s",
        buildPrompt: async () => "p",
        parseResult: () => ({}),
        usageTracking: tracking,
      },
      STAGES,
    );
    await expect(runStream()).rejects.toThrow(/\[ai-stream\] generateText 失败: timeout/);
    expect(h.fireRecordUsage).toHaveBeenCalledWith(tracking, expect.any(Number), undefined, false);
    expect(h.parts).toHaveLength(3); // 只有进度 part，无 result
  });

  it("parseResult 抛错：防御性包装成 [ai-stream] parseResult 失败", async () => {
    h.generateText.mockResolvedValue({ text: "not json", usage: undefined });
    createAiJsonProgressStream(
      {
        model,
        system: "s",
        buildPrompt: async () => "p",
        parseResult: () => {
          throw new Error("bad json");
        },
      },
      STAGES,
    );
    await expect(runStream()).rejects.toThrow(/\[ai-stream\] parseResult 失败: bad json/);
  });
});
