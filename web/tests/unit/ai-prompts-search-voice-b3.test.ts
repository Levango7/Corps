// 零覆盖清偿批 b3（搜索/语音/周报/工作流类 prompt 构造器）——覆盖 lib/ai/prompts 下
// semantic-search / task-breakdown / voice-intent-parse / weekly-report /
// wiki-search / workflow-build 六个文件。
import { describe, expect, it } from "vitest";

import type { FeedbackExample } from "@/lib/ai/feedback";
import {
  buildSemanticSearchSystemPrompt,
  buildSemanticSearchUserPrompt,
} from "@/lib/ai/prompts/semantic-search";
import {
  buildTaskBreakdownSystemPrompt,
  buildUserPrompt as buildTaskBreakdownUserPrompt,
} from "@/lib/ai/prompts/task-breakdown";
import {
  buildVoiceIntentPrompt,
  buildVoiceIntentSystemPrompt,
} from "@/lib/ai/prompts/voice-intent-parse";
import {
  buildWeeklyReportSystemPrompt,
  buildWeeklyReportUserPrompt,
  toWeeklyMilestone,
  toWeeklyTask,
  type WeekData,
  type WeeklyMilestone,
  type WeeklyTask,
  type WorkspaceContext as WeeklyWorkspaceContext,
} from "@/lib/ai/prompts/weekly-report";
import {
  buildWikiSearchSystemPrompt,
  buildWikiSearchUserPrompt,
} from "@/lib/ai/prompts/wiki-search";
import {
  buildWorkflowSystemPrompt,
  buildWorkflowUserPrompt,
} from "@/lib/ai/prompts/workflow-build";

const shot: FeedbackExample[] = [
  { originalOutput: null, correctedOutput: "更好的输出", comment: "更简洁" },
];

describe("semantic-search", () => {
  it("system prompt 声明关键词扩展契约与示例", () => {
    const p = buildSemanticSearchSystemPrompt();
    expect(p).toContain("语义搜索助手");
    expect(p).toContain('"expandedKeywords"');
    expect(p).toContain('"intent"');
    expect(p).toContain("4-6 个元素");
    expect(p).toContain("通用搜索");
  });

  it("user prompt 直接嵌入原始查询", () => {
    expect(buildSemanticSearchUserPrompt("部署流程")).toBe(
      "用户搜索查询：部署流程\n\n请分析查询意图并生成扩展关键词。",
    );
  });
});

describe("task-breakdown", () => {
  it("system prompt 声明子任务 JSON 契约", () => {
    const p = buildTaskBreakdownSystemPrompt();
    expect(p).toContain("拆解为可执行的子任务");
    expect(p).toContain('"subtasks"');
    expect(p).toContain('"estimatedHours"');
    expect(p).toContain('"suggestedAssignee"');
    expect(buildTaskBreakdownSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("user prompt 仅标题，描述与上下文可选注入", () => {
    expect(buildTaskBreakdownUserPrompt({ taskTitle: "登录模块" })).toBe("任务标题：登录模块");
    expect(
      buildTaskBreakdownUserPrompt({ taskTitle: "登录模块", taskDescription: "含表单校验" }),
    ).toContain("任务描述：含表单校验");
    expect(buildTaskBreakdownUserPrompt({ taskTitle: "登录模块", context: "本周冲刺" })).toContain(
      "额外上下文：本周冲刺",
    );
  });
});

describe("voice-intent-parse", () => {
  it("system prompt 声明七种意图与输出 JSON 契约", () => {
    const p = buildVoiceIntentSystemPrompt();
    expect(p).toContain("语音命令解析助手");
    for (const intent of [
      "create_task",
      "query_schedule",
      "send_message",
      "generate_report",
      "search_knowledge",
      "open_page",
      "unknown",
    ]) {
      expect(p).toContain(intent);
    }
    expect(p).toContain('"parameters"');
    expect(p).toContain('"confidence"');
    expect(p.match(/### 示例/g)).toHaveLength(4);
  });

  it("user prompt 注入工作区上下文段；空白上下文则省略", () => {
    expect(buildVoiceIntentPrompt("帮我创建任务", "当前页面：任务")).toContain(
      "## 工作区上下文\n当前页面：任务",
    );
    expect(buildVoiceIntentPrompt("帮我创建任务", "   ")).not.toContain("## 工作区上下文");
    expect(buildVoiceIntentPrompt("帮我创建任务", "")).toContain(
      "## 用户语音转录文本\n帮我创建任务",
    );
  });
});

describe("weekly-report", () => {
  const ctx: WeeklyWorkspaceContext = { workspaceName: "增长团队", memberCount: 6 };
  const weekData: WeekData = {
    weekStart: new Date("2026-09-07T00:00:00Z"),
    weekEnd: new Date("2026-09-13T00:00:00Z"),
    tasks: [
      {
        title: "完成登录接口",
        status: "done",
        priority: "high",
        assigneeName: "张三",
        dueDate: new Date("2026-09-12T00:00:00Z"),
        createdAt: new Date("2026-09-08T00:00:00Z"),
        updatedAt: new Date("2026-09-11T00:00:00Z"),
      },
    ],
    milestones: [
      { name: "V2.0 登录模块", dueDate: null, taskCount: 5, doneCount: 2 },
      { name: "空里程碑", dueDate: null, taskCount: 0, doneCount: 0 },
    ],
  };

  it("system prompt 声明周报五段契约", () => {
    const p = buildWeeklyReportSystemPrompt();
    expect(p).toContain("项目周报生成助手");
    expect(p).toContain('"completed"');
    expect(p).toContain('"planned"');
    expect(p).toContain('"risks"');
    expect(p).toContain('"milestones"');
    expect(p).toContain('"insights"');
    expect(buildWeeklyReportSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("user prompt 拼接工作区、周期、任务与里程碑行", () => {
    const p = buildWeeklyReportUserPrompt(ctx, weekData);
    expect(p).toContain("工作区：增长团队（6 人）");
    expect(p).toContain("本周周期：2026-09-07 至 2026-09-13");
    expect(p).toContain(
      "- 标题: 完成登录接口 | 状态: done | 优先级: high | 负责人: 张三 | 截止: 2026-09-12 | 更新: 2026-09-11",
    );
    expect(p).toContain("- 名称: V2.0 登录模块 | 截止: 无 | 进度: 2/5");
    // taskCount 为 0 时进度显示 0
    expect(p).toContain("- 名称: 空里程碑 | 截止: 无 | 进度: 0");
    expect(p).toContain("任务数据（共 1 条）：");
    expect(p).toContain("里程碑（共 2 个）：");
  });

  it("任务超 200 条、里程碑超 30 个分别截断；空走占位", () => {
    const manyTasks = Array.from({ length: 201 }, (_, i) => ({
      ...weekData.tasks[0],
      title: `t${i}`,
    }));
    const manyMs = Array.from({ length: 31 }, (_, i) => ({
      ...weekData.milestones[0],
      name: `m${i}`,
    }));
    const p = buildWeeklyReportUserPrompt(ctx, {
      ...weekData,
      tasks: manyTasks,
      milestones: manyMs,
    });
    expect(p).toContain("[已截断，仅显示前 200 条]");
    expect(p).toContain("[已截断，仅显示前 30 条]");
    const empty = buildWeeklyReportUserPrompt(ctx, {
      ...weekData,
      tasks: [],
      milestones: [],
    });
    expect(empty).toContain("（无任务）");
    expect(empty).toContain("（无里程碑）");
  });

  it("toWeeklyTask 负责人回退 email 再回退 null", () => {
    expect(
      toWeeklyTask({
        title: "t",
        status: "done",
        priority: "high",
        dueDate: null,
        createdAt: new Date("2026-09-01T00:00:00Z"),
        updatedAt: new Date("2026-09-02T00:00:00Z"),
        assignee: { name: "张三", email: "z@x.com" },
      }).assigneeName,
    ).toBe("张三");
    expect(
      toWeeklyTask({
        title: "t",
        status: "done",
        priority: "high",
        dueDate: null,
        createdAt: new Date("2026-09-01T00:00:00Z"),
        updatedAt: new Date("2026-09-02T00:00:00Z"),
        assignee: { name: null, email: "z@x.com" },
      }).assigneeName,
    ).toBe("z@x.com");
    expect(
      toWeeklyTask({
        title: "t",
        status: "todo",
        priority: "low",
        dueDate: null,
        createdAt: new Date("2026-09-01T00:00:00Z"),
        updatedAt: new Date("2026-09-01T00:00:00Z"),
        assignee: null,
      }).assigneeName,
    ).toBeNull();
  });

  it("toWeeklyMilestone 统计任务总数与完成数", () => {
    expect(
      toWeeklyMilestone({
        name: "M1",
        dueDate: new Date("2026-09-15T00:00:00Z"),
        tasks: [{ status: "done" }, { status: "done" }, { status: "in_progress" }],
      }),
    ).toEqual({
      name: "M1",
      dueDate: new Date("2026-09-15T00:00:00Z"),
      taskCount: 3,
      doneCount: 2,
    } satisfies WeeklyMilestone);
    expect(
      toWeeklyTask({
        title: "t",
        status: "done",
        priority: "high",
        dueDate: new Date("2026-09-01T00:00:00Z"),
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-09-01T00:00:00Z"),
        assignee: { name: "张三", email: "z@x.com" },
      }),
    ).toEqual<WeeklyTask>({
      title: "t",
      status: "done",
      priority: "high",
      assigneeName: "张三",
      dueDate: new Date("2026-09-01T00:00:00Z"),
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-09-01T00:00:00Z"),
    });
  });
});

describe("wiki-search", () => {
  it("system prompt 声明相关性排序契约", () => {
    const p = buildWikiSearchSystemPrompt();
    expect(p).toContain("Wiki 语义搜索助手");
    expect(p).toContain('"relevanceScore"');
    expect(p).toContain('"highlight"');
    expect(p).toContain('"pageId"');
    expect(buildWikiSearchSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("user prompt 编号拼接候选页面并截取前 500 字符", () => {
    const p = buildWikiSearchUserPrompt("部署流程", [
      { id: "p1", title: "部署规范", content: "c".repeat(501) },
      { id: "p2", title: "回滚手册", content: "短" },
    ]);
    expect(p.startsWith("用户查询：部署流程\n\n候选 Wiki 页面：\n")).toBe(true);
    expect(p).toContain("### 页面 1 (ID: p1)\n标题：部署规范");
    expect(p).toContain(" [...已截断]");
    expect(p).toContain("### 页面 2 (ID: p2)\n标题：回滚手册\n内容：短");
    expect(p.endsWith("请对页面进行相关性排序和摘要。")).toBe(true);
  });
});

describe("workflow-build", () => {
  it("system prompt 声明触发事件与动作类型枚举", () => {
    const p = buildWorkflowSystemPrompt();
    expect(p).toContain("工作流设计专家");
    for (const e of [
      "task.created",
      "task.completed",
      "document.published",
      "decision.made",
      "schedule.recurring",
    ]) {
      expect(p).toContain(e);
    }
    for (const a of [
      "notify",
      "create_task",
      "update_field",
      "send_message",
      "create_document",
      "call_webhook",
    ]) {
      expect(p).toContain(a);
    }
    expect(buildWorkflowSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("user prompt 直接嵌入需求描述", () => {
    expect(buildWorkflowUserPrompt("任务完成时通知负责人")).toBe(
      "用户需求：任务完成时通知负责人\n\n请生成工作流定义 JSON。",
    );
  });
});
