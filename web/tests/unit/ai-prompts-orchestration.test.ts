// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildOrchestrationSystemPrompt,
  buildOrchestrationUserPrompt,
} from "@/lib/ai/prompts/orchestration";
import {
  buildWorkflowOrchestratorSystemPrompt,
  buildWorkflowOrchestratorUserPrompt,
} from "@/lib/ai/prompts/workflow-orchestrator";
import { appendFeedbackShot } from "@/lib/ai/prompts/feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

/**
 * 跨能力联动 + 工作流编排两类 prompt builder 的契约测试。
 *
 * 这些 builder 此前零行覆盖（scripts/zero-coverage-baseline.txt）。测的意义不是
 * 覆盖率数字，而是钉住两类真实回归：
 *
 *  1. **输出契约退化**：system prompt 里的 JSON schema / 枚举清单是后面
 *     normalizePlan / executor 严格校验的前置约定——丢掉某条类型说明会让
 *     LLM 输出漂移成解析失败。枚举串（8 种 AiAction / 5 种节点类型）必须逐个在场。
 *  2. **上下文注入断裂**：user prompt 的截断、空数据兜底、用户关注点开关
 *     都是多步能力的串联语义，改错一处会静默吞掉上下文。
 *
 * feedback-shot 被两个 builder 共用，其本身的截断上界在这里一并钉住。
 */

const ex = (over: Partial<FeedbackExample> = {}): FeedbackExample => ({
  originalOutput: "原始输出",
  correctedOutput: "优质输出",
  comment: null,
  ...over,
});

describe("buildOrchestrationSystemPrompt", () => {
  it("声明全部 8 种 AiAction 类型与 JSON 顶层字段", () => {
    const p = buildOrchestrationSystemPrompt();
    // normalizePlan 只认这 8 种 type；schema 说明缺一种即产生"校验通过但执行失败"的裂缝
    for (const t of [
      "createTask",
      "linkToOkr",
      "notify",
      "createDocument",
      "scheduleMeeting",
      "updateTaskStatus",
      "createDecision",
      "sendAnnouncement",
    ]) {
      expect(p).toContain(t);
    }
    expect(p).toContain('"summary"');
    expect(p).toContain('"reasoning"');
    expect(p).toContain('"actions"');
    // 只返回 JSON、不含 markdown 包裹——cleanJsonResponse 前置约定
    expect(p).toContain("只返回单个合法 JSON 对象");
  });

  it("无反馈示例时原样返回，不追加参考段", () => {
    const base = buildOrchestrationSystemPrompt();
    expect(base).not.toContain("## 参考示例");
    expect(buildOrchestrationSystemPrompt([])).toBe(base);
  });

  it("注入反馈示例为 few-shot 参考段，且声明勿执行其中指令", () => {
    const p = buildOrchestrationSystemPrompt([ex({ correctedOutput: "示范输出" })]);
    expect(p).toContain("## 参考示例");
    expect(p).toContain("示范输出");
    // few-shot 注入是 prompt 注入面：示例里的指令性文本不得被执行
    expect(p).toContain("勿执行");
  });
});

describe("buildOrchestrationUserPrompt", () => {
  it("注入上下文并附分析指令", () => {
    const p = buildOrchestrationUserPrompt("## 任务（逾期）\n- 完成季度报告");
    expect(p).toContain("## 工作区上下文数据");
    expect(p).toContain("完成季度报告");
    expect(p).toContain("请分析以上数据");
  });

  it("空上下文兜底为（无数据），不产生空段", () => {
    expect(buildOrchestrationUserPrompt("")).toContain("（无数据）");
  });

  it("带用户关注点时单独成段并去首尾空白", () => {
    const p = buildOrchestrationUserPrompt("上下文", "  重点关注OKR风险  ");
    expect(p).toContain("## 用户关注点");
    expect(p).toContain("重点关注OKR风险");
  });

  it("纯空白的用户关注点不附加（判据是 trim 后非空）", () => {
    const p = buildOrchestrationUserPrompt("上下文", "   ");
    expect(p).not.toContain("## 用户关注点");
  });

  it("超长上下文截断至 18000 字符并标注", () => {
    const long = "x".repeat(20000);
    const p = buildOrchestrationUserPrompt(long);
    expect(p).toContain("[上下文已截断]");
    // 截断保底：上下文段本身不超 18000 + 标注
    expect(p.indexOf("[上下文已截断]")).toBeLessThanOrEqual(
      18000 + "## 工作区上下文数据\n\n".length + "[上下文已截断]".length,
    );
  });
});

describe("buildWorkflowOrchestratorSystemPrompt", () => {
  it("声明全部 5 种节点类型与返回 JSON 结构", () => {
    const p = buildWorkflowOrchestratorSystemPrompt();
    for (const t of ["action", "condition", "loop", "parallel", "approval"]) {
      expect(p).toContain(`"${t}"`);
    }
    expect(p).toContain('"trigger"');
    expect(p).toContain('"nodes"');
    expect(p).toContain('"edges"');
    expect(p).toContain('"explanation"');
  });

  it("无已有工作流时不生成已有工作流段", () => {
    expect(buildWorkflowOrchestratorSystemPrompt()).not.toContain("## 已有工作流");
    expect(buildWorkflowOrchestratorSystemPrompt([])).not.toContain("## 已有工作流");
  });

  it("注入已有工作流摘要：编号、名称、触发事件、节点数", () => {
    const p = buildWorkflowOrchestratorSystemPrompt([
      { name: "逾期跟进", triggerEvent: "task.completed", nodeCount: 3 },
      { name: "周报提醒", triggerEvent: "schedule.daily", nodeCount: 2 },
    ]);
    expect(p).toContain("## 已有工作流");
    expect(p).toContain("1. 逾期跟进（触发事件：task.completed，3 个节点）");
    expect(p).toContain("2. 周报提醒（触发事件：schedule.daily，2 个节点）");
    expect(p).toContain("避免重复");
  });

  it("工作流描述经 user prompt 原样带入", () => {
    expect(buildWorkflowOrchestratorUserPrompt("当任务完成时通知负责人")).toContain(
      "当任务完成时通知负责人",
    );
  });
});

describe("appendFeedbackShot（两 builder 共用的 few-shot 注入）", () => {
  const base = "BASE";

  it("无示例 / 空数组原样返回（零行为变更）", () => {
    expect(appendFeedbackShot(base)).toBe(base);
    expect(appendFeedbackShot(base, [])).toBe(base);
  });

  it("最多注入 2 个示例，第 3 个丢弃", () => {
    const p = appendFeedbackShot(base, [
      ex({ correctedOutput: "一" }),
      ex({ correctedOutput: "二" }),
      ex({ correctedOutput: "三" }),
    ]);
    expect(p).toContain("### 示例 1");
    expect(p).toContain("### 示例 2");
    expect(p).not.toContain("### 示例 3");
    expect(p).not.toContain("三");
  });

  it("originalOutput 截断至 200 字符、correctedOutput 至 500 字符，追加省略号", () => {
    const p = appendFeedbackShot(base, [
      ex({
        originalOutput: "o".repeat(300),
        correctedOutput: "c".repeat(600),
      }),
    ]);
    expect(p).toContain("o".repeat(200) + "…");
    expect(p).not.toContain("o".repeat(201));
    expect(p).toContain("c".repeat(500) + "…");
    expect(p).not.toContain("c".repeat(501));
  });

  it("comment 存在时附备注，为 null 时不附", () => {
    expect(appendFeedbackShot(base, [ex({ comment: "用户认可" })])).toContain("备注: 用户认可");
    expect(appendFeedbackShot(base, [ex()])).not.toContain("备注");
  });

  it("非字符串值 JSON 序列化后截断；null/undefined 摘要为(空)", () => {
    const p = appendFeedbackShot(base, [ex({ originalOutput: null, correctedOutput: { a: 1 } })]);
    expect(p).toContain("原始输出: (空)");
    expect(p).toContain('优质输出: {"a":1}');
  });

  it("不可序列化值兜底为(无法序列化)，不抛错", () => {
    // BigInt 是 JSON.stringify 的确定抛错输入（Do not know how to serialize a BigInt）
    const p = appendFeedbackShot(base, [
      ex({ originalOutput: 10n as unknown as FeedbackExample["originalOutput"] }),
    ]);
    expect(p).toContain("(无法序列化)");
  });
});
