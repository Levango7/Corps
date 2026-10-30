// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  ASSISTANT_CAPABILITIES,
  getPhaseRecommendation,
  getSuggestionsForPhase,
} from "@/lib/ai/assistant/orchestrator";

/**
 * AI 助理编排器的纯函数与配置面契约（lib/ai/assistant/orchestrator.ts）：
 *  - ASSISTANT_CAPABILITIES：12 项且**无重复**（模块内有去重守卫 + warn）
 *  - getSuggestionsForPhase：想定数量与 **id 必须全部在能力清单内**（防短语键/能力 ID 漂移）
 *  - getPhaseRecommendation：四分支流程链语义——
 *    无上一步→链首 / 上一步不在链中→链首（附原因）/ 已是链尾→无推荐 /
 *    否则→链中下一项；blocked 阶段链与其他阶段互异
 */
describe("ASSISTANT_CAPABILITIES", () => {
  it("12 项且无重复（去重守卫的静态判据）", () => {
    expect(ASSISTANT_CAPABILITIES).toHaveLength(12);
    expect(new Set(ASSISTANT_CAPABILITIES).size).toBe(ASSISTANT_CAPABILITIES.length);
  });

  it("关键能力都在清单里（审批建议/风险预警/日报）", () => {
    for (const cap of [
      "task_breakdown",
      "approval_advice",
      "risk_alert",
      "daily_report",
      "semantic_search",
    ]) {
      expect(ASSISTANT_CAPABILITIES).toContain(cap);
    }
  });
});

describe("getSuggestionsForPhase", () => {
  it("每阶段返回非空建议，且 id/短语键三件套齐全、id 全在能力清单内", () => {
    const phases = ["created", "in_progress", "review", "completed", "blocked"] as const;
    for (const phase of phases) {
      const list = getSuggestionsForPhase(phase);
      expect(list.length).toBeGreaterThan(0);
      for (const s of list) {
        expect(ASSISTANT_CAPABILITIES).toContain(s.id); // 防能力 ID 漂移
        expect(s.labelKey).toMatch(/^suggest\.\w+\.label$/);
        expect(s.descKey).toMatch(/^suggest\.\w+\.desc$/);
      }
    }
  });

  it("阶段语义抽样：created 引导拆解、review 引导决策/审批、blocked 引导瓶颈/风险", () => {
    expect(getSuggestionsForPhase("created").map((s) => s.id)).toEqual([
      "task_breakdown",
      "todo_extract",
    ]);
    expect(getSuggestionsForPhase("review").map((s) => s.id)).toEqual([
      "decision_assistant",
      "approval_advice",
    ]);
    const blocked = getSuggestionsForPhase("blocked").map((s) => s.id);
    expect(blocked).toContain("bottleneck_analysis");
    expect(blocked).toContain("risk_alert");
  });
});

describe("getPhaseRecommendation：四分支流程链", () => {
  it("无上一步：推荐链首并说明", () => {
    const r = getPhaseRecommendation("created");
    expect(r.nextCapability).toBe("task_breakdown");
    expect(r.reason).toContain("task_breakdown");
  });

  it("上一步在链中：推荐下一项", () => {
    expect(getPhaseRecommendation("created", "task_breakdown").nextCapability).toBe("todo_extract");
    expect(getPhaseRecommendation("created", "todo_extract").nextCapability).toBe("follow_up");
  });

  it("上一步不在链中：回退链首并注明原因", () => {
    const r = getPhaseRecommendation("review", "daily_report"); // daily_report 只在 completed 链
    expect(r.nextCapability).toBe("decision_assistant");
    expect(r.reason).toContain("不在");
    expect(r.reason).toContain("daily_report");
  });

  it("已是链尾：无 nextCapability（nextCapability undefined，不返回 null）", () => {
    const r = getPhaseRecommendation("review", "approval_advice");
    expect(r.nextCapability).toBeUndefined();
    expect(r.reason).toContain("已完成");
  });

  it("blocked 阶段与其他阶段流程互异（瓶颈→风险，而不是常规链）", () => {
    expect(getPhaseRecommendation("blocked").nextCapability).toBe("bottleneck_analysis");
    expect(getPhaseRecommendation("blocked", "bottleneck_analysis").nextCapability).toBe(
      "risk_alert",
    );
    expect(getPhaseRecommendation("blocked", "risk_alert").nextCapability).toBeUndefined();
  });

  it("五个阶段的链首都可推荐（不存在空链阶段）", () => {
    for (const phase of ["created", "in_progress", "review", "completed", "blocked"] as const) {
      expect(getPhaseRecommendation(phase).nextCapability).toBeTruthy();
    }
  });
});
