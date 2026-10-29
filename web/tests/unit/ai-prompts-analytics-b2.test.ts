// 零覆盖清偿批 b2（分析/决策类 prompt 构造器）——覆盖 lib/ai/prompts 下
// follow-up / daily-briefing / daily-report / decision-assistant /
// project-insight / meeting-transcript-analysis 六个文件的纯函数分支。
import { describe, expect, it } from "vitest";

import type { FeedbackExample } from "@/lib/ai/feedback";
import {
  buildDailyBriefingPrompt,
  buildDailyBriefingUserPrompt,
  type WorkspaceContext,
} from "@/lib/ai/prompts/daily-briefing";
import { buildDailyReportSystemPrompt, buildUserPrompt } from "@/lib/ai/prompts/daily-report";
import {
  buildDecisionAssistantSystemPrompt,
  buildDecisionAssistantUserPrompt,
  type DecisionContext,
} from "@/lib/ai/prompts/decision-assistant";
import { buildFollowUpSystemPrompt, buildFollowUpUserPrompt } from "@/lib/ai/prompts/follow-up";
import {
  buildMeetingAnalysisPrompt,
  buildMeetingAnalysisSystemPrompt,
} from "@/lib/ai/prompts/meeting-transcript-analysis";
import {
  buildProjectInsightSystemPrompts,
  buildUserPrompt as buildProjectInsightUserPrompt,
} from "@/lib/ai/prompts/project-insight";

const shot: FeedbackExample[] = [
  { originalOutput: null, correctedOutput: "更好的输出", comment: "更简洁" },
];

describe("follow-up", () => {
  it("system prompt 声明追问生成器角色与 JSON 数组输出契约", () => {
    const p = buildFollowUpSystemPrompt();
    expect(p).toContain("追问建议生成器");
    expect(p).toContain('["追问1", "追问2", "追问3"]');
    expect(p).toContain("恰好 3 个追问");
    // 3 个 few-shot 示例均存在
    expect(p.match(/### 示例/g)).toHaveLength(3);
  });

  it("feedback 示例被注入 system prompt", () => {
    expect(buildFollowUpSystemPrompt(shot)).toContain("## 参考示例");
    expect(buildFollowUpSystemPrompt(shot)).not.toBe(buildFollowUpSystemPrompt());
  });

  it("user prompt 拼接问题与回答两个段落", () => {
    const p = buildFollowUpUserPrompt("任务状态？", "共 2 项进行中");
    expect(p.startsWith("## 用户问题\n任务状态？\n\n## AI 回答\n共 2 项进行中")).toBe(true);
    expect(p).toContain("请生成 3 个后续追问建议");
  });

  it("超长问题（>1000）与超长回答（>4000）分别截断", () => {
    const p = buildFollowUpUserPrompt("问".repeat(1001), "答".repeat(4001));
    expect(p).toContain("[问题已截断]");
    expect(p).toContain("[回答已截断]");
    const ok = buildFollowUpUserPrompt("问".repeat(1000), "答".repeat(4000));
    expect(ok).not.toContain("[问题已截断]");
    expect(ok).not.toContain("[回答已截断]");
  });
});

describe("daily-briefing", () => {
  const ctx: WorkspaceContext = {
    context: "- 今日任务 2 项",
    workspaceId: "ws-brief",
    userId: "u-1",
  };

  it("system prompt 标注工作区范围并声明条目/优先级枚举", () => {
    const p = buildDailyBriefingPrompt(ctx);
    expect(p).toContain("每日简报助手");
    expect(p).toContain("工作区范围：ws-brief");
    expect(p).toContain('"type": "task" | "meeting" | "message"');
    expect(p).toContain('"priority": "high" | "medium" | "low"');
    expect(p).toContain('"title"');
    expect(p).toContain("今日暂无重要安排");
  });

  it("user prompt 以今日工作数据开头并截断超长上下文", () => {
    expect(buildDailyBriefingUserPrompt(ctx)).toBe("今日工作数据：\n- 今日任务 2 项");
    const long = buildDailyBriefingUserPrompt({ ...ctx, context: "x".repeat(12001) });
    expect(long).toContain("[上下文已截断]");
    expect(long.length).toBeLessThan(12000 + 100);
  });
});

describe("daily-report", () => {
  it("system prompt 声明 markdown 四段式日报契约", () => {
    const p = buildDailyReportSystemPrompt();
    expect(p).toContain("工作日报生成助手");
    expect(p).toContain("今日完成");
    expect(p).toContain("进行中");
    expect(p).toContain("问题与风险");
    expect(p).toContain("明日计划");
  });

  it("feedback 示例可注入", () => {
    expect(buildDailyReportSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("有效日期解析为 YYYY-MM-DD 前缀", () => {
    expect(buildUserPrompt("数据", { date: "2026-09-14" })).toContain("日期：2026-09-14");
  });

  it("缺省日期使用当天", () => {
    expect(buildUserPrompt("数据", {})).toMatch(
      /^日期：\d{4}-\d{2}-\d{2}\n\n今日工作数据：\n数据$/,
    );
  });

  it("无效日期走友好错误分支", () => {
    const p = buildUserPrompt("数据", { date: "not-a-date" });
    expect(p.startsWith("## 日期无效")).toBe(true);
    expect(p).toContain('无法解析日期 "not-a-date"');
    expect(p).not.toContain("今日工作数据");
  });

  it("超长上下文截断", () => {
    expect(buildUserPrompt("x".repeat(12001), { date: "2026-09-14" })).toContain("[上下文已截断]");
  });
});

describe("decision-assistant", () => {
  const base: DecisionContext = {
    tasks: [{ title: "接口联调", status: "in_progress", priority: "high" }],
    decisions: [{ taskTitle: "技术选型", markdown: "采用 PostgreSQL", createdAt: "2026-09-01" }],
    progress: { totalTasks: 10, completedTasks: 4, inProgressTasks: 3, blockedTasks: 1 },
  };

  it("system prompt 注入进度、任务与决策摘要", () => {
    const p = buildDecisionAssistantSystemPrompt(base);
    expect(p).toContain("决策辅助助手");
    expect(p).toContain("总计 10 个任务，已完成 4，进行中 3，阻塞 1");
    expect(p).toContain("- [in_progress/high] 接口联调");
    expect(p).toContain("- 技术选型（2026-09-01）：采用 PostgreSQL");
    expect(p).toContain('"historicalRefs"');
    expect(p).toContain('"optionIndex"');
  });

  it("空任务/空决策走占位分支", () => {
    const p = buildDecisionAssistantSystemPrompt({
      tasks: [],
      decisions: [],
      progress: { totalTasks: 0, completedTasks: 0, inProgressTasks: 0, blockedTasks: 0 },
    });
    expect(p).toContain("（暂无任务）");
    expect(p).toContain("（暂无历史决策）");
    expect(p).toContain("总计 0 个任务，已完成 0，进行中 0，阻塞 0");
  });

  it("历史决策 markdown 截取前 200 字符", () => {
    const p = buildDecisionAssistantSystemPrompt({
      ...base,
      decisions: [{ taskTitle: "长决策", markdown: "x".repeat(300), createdAt: "2026-09-02" }],
    });
    expect(p).toContain("x".repeat(200));
    expect(p).not.toContain("x".repeat(201));
  });

  it("user prompt 拼接决策问题，可选拓展背景", () => {
    expect(buildDecisionAssistantUserPrompt("是否引入缓存？")).toBe("决策问题：是否引入缓存？");
    expect(buildDecisionAssistantUserPrompt("是否引入缓存？", "团队熟悉 Redis")).toContain(
      "补充背景：团队熟悉 Redis",
    );
    // 空白背景不注入
    expect(buildDecisionAssistantUserPrompt("是否引入缓存？", "   ")).not.toContain("补充背景");
  });
});

describe("project-insight", () => {
  it("返回 progress/risk/summary/weekly 四个维度 prompt", () => {
    const prompts = buildProjectInsightSystemPrompts();
    expect(Object.keys(prompts)).toEqual(["progress", "risk", "summary", "weekly"]);
    expect(prompts.progress).toContain("项目进度分析助手");
    expect(prompts.risk).toContain("项目风险识别助手");
    expect(prompts.summary).toContain("项目概览助手");
    expect(prompts.weekly).toContain("项目周报生成助手");
    // 无反馈示例时不含参考示例段
    expect(prompts.progress).not.toContain("## 参考示例");
  });

  it("反馈示例注入到全部四个维度", () => {
    const prompts = buildProjectInsightSystemPrompts(shot);
    for (const [scope, p] of Object.entries(prompts)) {
      expect(p, scope).toContain("## 参考示例");
    }
  });

  it("user prompt 标注分析维度并截断超长项目数据", () => {
    expect(buildProjectInsightUserPrompt("完成率 70%", "risk")).toBe(
      "分析维度：risk\n\n项目数据：\n完成率 70%",
    );
    expect(buildProjectInsightUserPrompt("x".repeat(12001), "weekly")).toContain("[上下文已截断]");
  });
});

describe("meeting-transcript-analysis", () => {
  it("system prompt 声明行动项/决策/摘要 JSON 契约", () => {
    const p = buildMeetingAnalysisSystemPrompt();
    expect(p).toContain("会议分析助手");
    expect(p).toContain('"summary"');
    expect(p).toContain('"actionItems"');
    expect(p).toContain('"decisions"');
    expect(p).toContain('"confidence"');
    expect(p).toContain('"participants"');
    expect(p).toContain("会议内容不足");
  });

  it("user prompt 同时截断转录（15000）与工作区上下文（4000）", () => {
    const p = buildMeetingAnalysisPrompt("t".repeat(15001), "c".repeat(4001));
    expect(p).toContain("[... 转录文本已截断 ...]");
    expect(p).toContain("[上下文已截断]");
    expect(p).toContain("工作区上下文（成员名单/项目信息，用于辅助识别人名）：");
    expect(p).toContain("会议转录文本：");
    const ok = buildMeetingAnalysisPrompt("t".repeat(15000), "c".repeat(4000));
    expect(ok).not.toContain("转录文本已截断");
    expect(ok).not.toContain("[上下文已截断]");
  });
});
