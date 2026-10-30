// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AI 使用量跟踪契约（lib/ai/usage-middleware.ts）：
 *  - withUsageTracking：**配额断言在 fn 之前**（超限即中断，不发模型调用，2026-10-08 起真拦截）；
 *    成功返回 result 并记录 tokens；失败原样抛出但 finally 仍记 success=false
 *  - fireRecordUsage（流式 onFinish 用）：workspaceId 为空时**跳过**（AiUsageLog.workspaceId 必填外键）；
 *    usage 缺省补 0；success 可显式传 false
 *  - 记录失败（recordAiUsage reject）只 console.error，不影响主流程
 */
const h = vi.hoisted(() => ({
  recordAiUsage: vi.fn(),
  assertAiUsageQuota: vi.fn(),
  err: vi.fn(),
}));

vi.mock("@/lib/ai/usage-tracker", () => ({ recordAiUsage: h.recordAiUsage }));
vi.mock("@/lib/ai/usage-limit", () => ({ assertAiUsageQuota: h.assertAiUsageQuota }));

import { fireRecordUsage, withUsageTracking } from "@/lib/ai/usage-middleware";

const PARAMS = {
  workspaceId: "w1",
  userId: "u1",
  capability: "knowledge-qa",
  model: "deepseek-chat",
};

beforeEach(() => {
  h.recordAiUsage.mockReset();
  h.recordAiUsage.mockResolvedValue(undefined);
  h.assertAiUsageQuota.mockReset();
  h.assertAiUsageQuota.mockResolvedValue(undefined);
  h.err.mockReset();
  vi.spyOn(console, "error").mockImplementation(h.err);
});

describe("withUsageTracking", () => {
  it("配额超限：抛错且 fn 根本不被调用（不发起模型调用），也不记录 usage", async () => {
    h.assertAiUsageQuota.mockRejectedValue(new Error("quota exceeded"));
    const fn = vi.fn();
    await expect(withUsageTracking(PARAMS, fn)).rejects.toThrow("quota exceeded");
    expect(fn).not.toHaveBeenCalled();
    expect(h.recordAiUsage).not.toHaveBeenCalled();
  });

  it("成功：返回 result，记录 tokens 与 success:true，且 durationMs 为数字", async () => {
    const res = await withUsageTracking(PARAMS, async () => ({
      result: "answer",
      usage: { inputTokens: 11, outputTokens: 22 },
    }));
    expect(res).toBe("answer");
    expect(h.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "w1",
        userId: "u1",
        capability: "knowledge-qa",
        model: "deepseek-chat",
        inputTokens: 11,
        outputTokens: 22,
        success: true,
      }),
    );
    expect(typeof h.recordAiUsage.mock.calls[0][0].durationMs).toBe("number");
  });

  it("fn 无 usage：tokens 记 0", async () => {
    await withUsageTracking(PARAMS, async () => ({ result: 1 }));
    expect(h.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 0, outputTokens: 0, success: true }),
    );
  });

  it("失败：异常原样抛出，但 finally 记录 success:false（token 记 0）", async () => {
    await expect(
      withUsageTracking(PARAMS, async () => {
        throw new Error("llm down");
      }),
    ).rejects.toThrow("llm down");
    expect(h.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, inputTokens: 0, outputTokens: 0 }),
    );
  });

  it("记录失败（reject）只 console.error，不影响返回值", async () => {
    h.recordAiUsage.mockRejectedValue(new Error("db down"));
    const res = await withUsageTracking(PARAMS, async () => ({ result: "ok" }));
    expect(res).toBe("ok");
    // catch 在微任务里 —— 等一轮事件循环
    await Promise.resolve();
    await Promise.resolve();
    expect(h.err).toHaveBeenCalledWith(
      "[usage-tracking] Failed to record usage:",
      expect.any(Error),
    );
  });
});

describe("fireRecordUsage（流式 onFinish）", () => {
  it("workspaceId 为空：跳过记录（必填外键不能为 null）", () => {
    fireRecordUsage({ ...PARAMS, workspaceId: "" }, Date.now());
    expect(h.recordAiUsage).not.toHaveBeenCalled();
  });

  it("usage 缺省：tokens 记 0；success 默认 true", () => {
    fireRecordUsage(PARAMS, Date.now() - 5);
    expect(h.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 0, outputTokens: 0, success: true }),
    );
  });

  it("显式传 usage 与 success=false：原样落账", () => {
    fireRecordUsage(PARAMS, Date.now(), { inputTokens: 3, outputTokens: 4 }, false);
    expect(h.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 3, outputTokens: 4, success: false }),
    );
  });

  it("记录失败只 console.error（流式路径不能因埋点炸掉）", async () => {
    h.recordAiUsage.mockRejectedValue(new Error("db down"));
    expect(() => fireRecordUsage(PARAMS, Date.now())).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.err).toHaveBeenCalledWith(
      "[usage-tracking] Failed to record stream usage:",
      expect.any(Error),
    );
  });
});
