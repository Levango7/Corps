// @vitest-environment node
import { describe, it, expect } from "vitest";
import { cleanJsonResponse, normalizePlan, validateActionFields } from "@/lib/ai/orchestrator";

/**
 * 跨能力联动编排引擎的**纯校验层**测试（cleanJsonResponse /
 * validateActionFields / normalizePlan）。
 *
 * 这三个函数是 LLM 自由输出与 RLS 事务执行之间的唯一闸门：
 *  - 校验过宽 → 非法 action 进入 executeAiActions，在事务里炸成回滚
 *  - 校验过紧（误拒合法 action）→ 用户看到的建议方案莫名缺条目
 * 枚举校验与 executor 的白名单**必须保持一致**（源码注释也如此要求），
 * 所以这里对 8 种 type 逐个钉合法形态与代表性非法形态。
 *
 * 不测 suggestOrchestration / executeOrchestration：它们走真实 LLM + DB 事务，
 * 属集成层（已有文档说明执行须用户确认）；纯校验层零依赖，先钉死。
 */

describe("cleanJsonResponse", () => {
  it("普通 JSON 原样返回（去首尾空白）", () => {
    expect(cleanJsonResponse('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("剥离 ```json 代码块包裹", () => {
    expect(cleanJsonResponse('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("剥离无语言标记的 ``` 包裹", () => {
    expect(cleanJsonResponse('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("非 JSON 文本不动（交给上层 JSON.parse 判错）", () => {
    expect(cleanJsonResponse("就是一段话")).toBe("就是一段话");
  });
});

describe("validateActionFields", () => {
  it("createTask：齐全 + 合法 priority 通过", () => {
    expect(
      validateActionFields({
        type: "createTask",
        title: "跟进季度报告",
        description: "原任务已逾期",
        priority: "high",
      }),
    ).toBe(true);
  });

  it("createTask：可选字段类型正确也算通过", () => {
    expect(
      validateActionFields({
        type: "createTask",
        title: "t",
        description: "d",
        priority: "low",
        assigneeId: "u1",
        dueDate: "2026-09-16T18:00:00Z",
      }),
    ).toBe(true);
  });

  it("createTask：空标题 / 非法 priority / 缺 description / 可选字段类型错都拒", () => {
    expect(
      validateActionFields({ type: "createTask", title: "  ", description: "d", priority: "low" }),
    ).toBe(false);
    expect(
      validateActionFields({
        type: "createTask",
        title: "t",
        description: "d",
        priority: "critical",
      }),
    ).toBe(false);
    expect(validateActionFields({ type: "createTask", title: "t", priority: "low" })).toBe(false);
    expect(
      validateActionFields({
        type: "createTask",
        title: "t",
        description: "d",
        priority: "low",
        assigneeId: 42,
      }),
    ).toBe(false);
  });

  it("linkToOkr / notify / createDecision：双必填字符串", () => {
    expect(validateActionFields({ type: "linkToOkr", taskId: "t1", keyResultId: "kr1" })).toBe(
      true,
    );
    expect(validateActionFields({ type: "linkToOkr", taskId: "t1" })).toBe(false);
    expect(validateActionFields({ type: "notify", userId: "u1", message: "m" })).toBe(true);
    expect(validateActionFields({ type: "notify", userId: "u1" })).toBe(false);
    expect(validateActionFields({ type: "createDecision", taskId: "t1", markdown: "# 决策" })).toBe(
      true,
    );
    expect(validateActionFields({ type: "createDecision", taskId: "t1", markdown: 1 })).toBe(false);
  });

  it("createDocument：title+markdown 必填，authorId 可选", () => {
    expect(
      validateActionFields({ type: "createDocument", title: "执行方案", markdown: "## 方案" }),
    ).toBe(true);
    expect(
      validateActionFields({ type: "createDocument", title: "t", markdown: "m", authorId: "u1" }),
    ).toBe(true);
    expect(validateActionFields({ type: "createDocument", title: "t" })).toBe(false);
    expect(
      validateActionFields({ type: "createDocument", title: "t", markdown: "m", authorId: 7 }),
    ).toBe(false);
  });

  it("scheduleMeeting：scheduledAt 必填，participantIds 须字符串数组", () => {
    expect(
      validateActionFields({
        type: "scheduleMeeting",
        title: "复盘",
        scheduledAt: "2026-09-16T10:00:00Z",
      }),
    ).toBe(true);
    expect(
      validateActionFields({
        type: "scheduleMeeting",
        title: "复盘",
        scheduledAt: "2026-09-16T10:00:00Z",
        description: "OKR 复盘",
        participantIds: ["u1", "u2"],
      }),
    ).toBe(true);
    expect(
      validateActionFields({
        type: "scheduleMeeting",
        title: "复盘",
        scheduledAt: "2026-09-16T10:00:00Z",
        participantIds: ["u1", 3],
      }),
    ).toBe(false);
    expect(validateActionFields({ type: "scheduleMeeting", title: "复盘" })).toBe(false);
  });

  it("updateTaskStatus：status 必须在四档枚举内", () => {
    expect(
      validateActionFields({ type: "updateTaskStatus", taskId: "t1", status: "in_progress" }),
    ).toBe(true);
    expect(
      validateActionFields({ type: "updateTaskStatus", taskId: "t1", status: "archived" }),
    ).toBe(false);
    expect(validateActionFields({ type: "updateTaskStatus", taskId: "t1" })).toBe(false);
  });

  it("sendAnnouncement：announcementType 三档枚举，targetAudience 须对象", () => {
    expect(validateActionFields({ type: "sendAnnouncement", title: "t", content: "c" })).toBe(true);
    expect(
      validateActionFields({
        type: "sendAnnouncement",
        title: "t",
        content: "c",
        announcementType: "warning",
      }),
    ).toBe(true);
    expect(
      validateActionFields({
        type: "sendAnnouncement",
        title: "t",
        content: "c",
        announcementType: "critical",
      }),
    ).toBe(false);
    expect(
      validateActionFields({
        type: "sendAnnouncement",
        title: "t",
        content: "c",
        targetAudience: { dept: "eng" },
      }),
    ).toBe(true);
    expect(
      validateActionFields({
        type: "sendAnnouncement",
        title: "t",
        content: "c",
        targetAudience: null,
      }),
    ).toBe(false);
    expect(
      validateActionFields({
        type: "sendAnnouncement",
        title: "t",
        content: "c",
        targetAudience: "all",
      }),
    ).toBe(false);
  });

  it("未知 type 一律拒（拼写错误不得静默落到执行层）", () => {
    expect(validateActionFields({ type: "createTasks", title: "t" })).toBe(false);
    expect(validateActionFields({})).toBe(false);
  });
});

describe("normalizePlan", () => {
  const validPlan = {
    summary: "逾期任务跟进",
    reasoning: "检测到 1 个高优先级逾期任务",
    actions: [{ type: "notify", userId: "u1", message: "请关注" }],
  };

  it("非对象 / 缺 summary / 缺 reasoning / actions 非数组 → null", () => {
    expect(normalizePlan(null)).toBeNull();
    expect(normalizePlan("string")).toBeNull();
    expect(normalizePlan({ summary: "s" })).toBeNull();
    expect(normalizePlan({ summary: "  ", reasoning: "r", actions: [] })).toBeNull();
    expect(normalizePlan({ summary: "s", reasoning: "   ", actions: [] })).toBeNull();
    expect(normalizePlan({ summary: "s", reasoning: "r", actions: "nope" })).toBeNull();
  });

  it("合法方案原样规范化（保留合法 action）", () => {
    const plan = normalizePlan(validPlan)!;
    expect(plan.summary).toBe("逾期任务跟进");
    expect(plan.reasoning).toBe("检测到 1 个高优先级逾期任务");
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ type: "notify", userId: "u1" });
  });

  it("summary / reasoning 超长按 Unicode 码点截断（不截断 emoji 代理对）", () => {
    const summary = "🔥".repeat(101); // 101 个码点，slice 会拆代理对
    const reasoning = "a".repeat(600);
    const plan = normalizePlan({ summary, reasoning, actions: [] })!;
    expect(Array.from(plan.summary)).toHaveLength(100);
    expect(plan.reasoning).toHaveLength(500);
    expect(plan.summary).not.toContain("�"); // 未产生 Replacement Character ⇒ 未从代理对中间截断
  });

  it("actions 超过 5 个截断为 5（不整单拒）", () => {
    const actions = Array.from({ length: 7 }, (_, i) => ({
      type: "notify" as const,
      userId: `u${i}`,
      message: "m",
    }));
    const plan = normalizePlan({ summary: "s", reasoning: "r", actions })!;
    expect(plan.actions).toHaveLength(5);
    expect(plan.actions[4]).toMatchObject({ userId: "u4" });
  });

  it("跳过非对象 / 非法 type / 必填缺失的 action，保留其余", () => {
    const plan = normalizePlan({
      summary: "s",
      reasoning: "r",
      actions: [
        null,
        "not-an-object",
        { type: "createTasks", title: "拼写错误" },
        { type: "notify", message: "缺 userId" },
        { type: "notify", userId: "u1", message: "合法" },
      ],
    })!;
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ type: "notify", userId: "u1" });
  });

  it("全部 action 非法时返回空 actions（而非 null）", () => {
    const plan = normalizePlan({
      summary: "工作区状态正常",
      reasoning: "无异常",
      actions: [{ type: "nope" }],
    })!;
    expect(plan.actions).toEqual([]);
  });
});
