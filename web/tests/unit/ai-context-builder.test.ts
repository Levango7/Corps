// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { buildTaskContext, phaseTransitionAdvice } from "@/lib/ai/assistant/context-builder";

/**
 * AI 助理上下文构建器的契约测试（此前零行覆盖）。
 *
 * 两条真实回归面：
 *  1. buildTaskContext 的降级边界——taskId 未传 / 任务不存在时必须返回空串
 *     而不是抛错或半截字符串（runAssistant 把返回值直接当 previousOutput）。
 *  2. phaseTransitionAdvice 的 `!result → null` 前置——调用方依赖 null 来
 *     决定"不展示引导"，漏掉这个判断会让 UI 在无上下文时弹空建议。
 */

/** 最小 tx mock：只需要 task.findUnique */
function makeTx(returnValue: unknown) {
  return {
    task: { findUnique: vi.fn(async () => returnValue) },
  } as unknown as Prisma.TransactionClient;
}

const fullTask = {
  title: "上线发布",
  description: "按 runbook 执行",
  status: "in_progress",
  priority: "high",
  dueDate: new Date("2026-10-15T00:00:00.000Z"),
};

describe("buildTaskContext", () => {
  it("taskId 未传 → 空串且不查库", async () => {
    const tx = makeTx(fullTask);
    expect(await buildTaskContext(tx, "ws-1")).toBe("");
    expect((tx.task.findUnique as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("任务不存在 → 空串（不抛错，previousOutput 走空值分支）", async () => {
    const tx = makeTx(null);
    expect(await buildTaskContext(tx, "ws-1", "task-404")).toBe("");
  });

  it("完整任务 → 标题/状态/优先级/描述/截止日期全部拼入", async () => {
    const tx = makeTx(fullTask);
    const ctx = await buildTaskContext(tx, "ws-1", "task-1");
    expect(ctx).toContain("当前任务：上线发布（状态：in_progress，优先级：high）");
    expect(ctx).toContain("描述：按 runbook 执行");
    expect(ctx).toContain("截止日期：2026-10-15T00:00:00.000Z");
  });

  it("description / dueDate 缺省时对应行不出现（不输出空段）", async () => {
    const tx = makeTx({ ...fullTask, description: null, dueDate: null });
    const ctx = await buildTaskContext(tx, "ws-1", "task-1");
    expect(ctx).toContain("当前任务：上线发布");
    expect(ctx).not.toContain("描述：");
    expect(ctx).not.toContain("截止日期：");
  });
});

describe("phaseTransitionAdvice", () => {
  it("无前步结果 → null（调用方据此不展示引导，漏判会弹空建议）", () => {
    expect(phaseTransitionAdvice("created")).toBeNull();
    expect(phaseTransitionAdvice("created", "")).toBeNull();
  });

  it("五个已知阶段各自返回对应文案", () => {
    expect(phaseTransitionAdvice("created", "r")).toContain("拆解子任务");
    expect(phaseTransitionAdvice("in_progress", "r")).toContain("检查进度");
    expect(phaseTransitionAdvice("review", "r")).toContain("完成标准");
    expect(phaseTransitionAdvice("completed", "r")).toContain("总结经验");
    expect(phaseTransitionAdvice("blocked", "r")).toContain("分析原因");
  });

  it("未知阶段 → null（不编造建议）", () => {
    expect(phaseTransitionAdvice("ghost_phase", "r")).toBeNull();
  });
});
