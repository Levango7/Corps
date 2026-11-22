// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * DeepSeek 模型构造形态防回归（lib/ai/deepseek.ts）
 *
 * 背景（2026-11-22 AI 域实机验收抓到的头号 bug）：@ai-sdk/openai v4 的默认
 * provider 调用走 OpenAI Responses API（/v1/responses），而 DeepSeek 只有
 * /v1/chat/completions——`deepseek("deepseek-chat")` 默认构造在真实 HTTP 下
 * 404（AI_APICallError: not found），主 provider 从未通过，全部流量被
 * OpenAI fallback 吃掉。DeepSeek 侧模型必须显式 `.chat(...)` 钉 Chat Completions。
 *
 * 本测试用 mock provider 捕获两种构造路径：默认调用（=Responses）与 .chat 调用，
 * 断言 deepseek.ts 里 DeepSeek 模型只走 .chat。
 */

const capture = vi.hoisted(() => ({
  defaultCalls: [] as string[],
  chatCalls: [] as string[],
}));

vi.mock("@ai-sdk/openai", () => {
  const makeProvider = () => {
    const provider = (modelId: string) => {
      capture.defaultCalls.push(modelId);
      return { __kind: "responses", modelId };
    };
    provider.chat = (modelId: string) => {
      capture.chatCalls.push(modelId);
      return { __kind: "chat", modelId };
    };
    provider.responses = (modelId: string) => ({ __kind: "responses", modelId });
    return provider;
  };
  return { createOpenAI: vi.fn(() => makeProvider()) };
});

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  capture.defaultCalls.length = 0;
  capture.chatCalls.length = 0;
  vi.resetModules();
});

describe("deepseek 模型构造形态", () => {
  it("DeepSeek 两侧模型都显式走 .chat（Chat Completions），不落默认 Responses 构造", async () => {
    await import("@/lib/ai/deepseek");

    expect(capture.chatCalls.sort()).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    // 默认构造（=Responses API）只允许 OpenAI fallback 模型（官方支持 /responses）
    const deepseekDefaults = capture.defaultCalls.filter((id) => id.startsWith("deepseek-"));
    expect(
      deepseekDefaults,
      "deepseek(id) 默认构造会打 /v1/responses，DeepSeek 无此端点（404）",
    ).toEqual([]);
  });

  it("OpenAI fallback 走默认构造（官方支持 /responses）", async () => {
    await import("@/lib/ai/deepseek");

    // gpt-4o-mini / o3-mini 不在 .chat 捕获列表里
    expect(capture.chatCalls).not.toContain("gpt-4o-mini");
    expect(capture.chatCalls).not.toContain("o3-mini");
  });

  it("空字符串 key 视为未配置（!!'' 为 false，按钮置灰语义）", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const mod = await import("@/lib/ai/deepseek");
    const shared = await import("@/lib/ai/shared");

    expect(mod.isDeepSeekConfigured()).toBe(false);
    expect(mod.isOpenAIConfigured()).toBe(false);
    expect(shared.isAiConfigured()).toBe(false);
  });
});
