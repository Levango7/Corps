// 零覆盖清偿批 b2（知识/邮件/会议流程/个性化 prompt 构造器）——覆盖 lib/ai/prompts 下
// doc-qa / knowledge-extract / knowledge-qa / mail-assistant / meeting-flow /
// personalization 六个文件的纯函数分支。
import { describe, expect, it } from "vitest";

import type { FeedbackExample } from "@/lib/ai/feedback";
import type { AiUserBehavior } from "@prisma/client";
import { buildDocQaSystemPrompt, buildDocQaUserPrompt } from "@/lib/ai/prompts/doc-qa";
import { buildKnowledgeExtractPrompt } from "@/lib/ai/prompts/knowledge-extract";
import {
  buildKnowledgeQaSystemPrompt,
  buildKnowledgeQaUserPrompt,
} from "@/lib/ai/prompts/knowledge-qa";
import {
  buildMailClassifySystemPrompt,
  buildMailClassifyUserPrompt,
  buildMailDraftSystemPrompt,
  buildMailDraftUserPrompt,
  buildMailReplySystemPrompt,
  buildMailReplyUserPrompt,
  buildMailSummarizeSystemPrompt,
  buildMailSummarizeUserPrompt,
} from "@/lib/ai/prompts/mail-assistant";
import {
  buildPostMeetingPrompt,
  buildPostMeetingSystemPrompt,
  buildPreMeetingPrompt,
  buildPreMeetingSystemPrompt,
} from "@/lib/ai/prompts/meeting-flow";
import {
  buildPersonalizationPrompt,
  buildPersonalizationSystemPrompt,
} from "@/lib/ai/prompts/personalization";

const shot: FeedbackExample[] = [
  { originalOutput: null, correctedOutput: "更好的输出", comment: "更简洁" },
];

function behavior(
  capability: string,
  action: string,
  createdAt: Date,
  metadata?: Record<string, unknown>,
): AiUserBehavior {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    workspaceId: "00000000-0000-0000-0000-000000000002",
    userId: "00000000-0000-0000-0000-000000000003",
    capability,
    action,
    metadata: metadata ?? null,
    createdAt,
  } as unknown as AiUserBehavior;
}

describe("doc-qa", () => {
  it("system prompt 声明来源引用规则", () => {
    const p = buildDocQaSystemPrompt();
    expect(p).toContain("项目文档问答助手");
    expect(p).toContain("## 来源");
    expect(p).toContain("**文档标题**");
    expect(p).toContain("文档中未找到相关内容");
  });

  it("feedback 示例可注入", () => {
    expect(buildDocQaSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("无检索结果时走未检索到分支", () => {
    const p = buildDocQaUserPrompt("部署流程是什么？", []);
    expect(p).toContain("## 用户问题");
    expect(p).toContain("未检索到相关文档。");
    expect(p).toContain("建议补充文档或换个问题");
  });

  it("文档列表编号拼接并截取前 2000 字符", () => {
    const p = buildDocQaUserPrompt("部署流程", [
      { title: "部署规范", content: "a".repeat(2001) },
      { title: "回滚手册", content: "b".repeat(10) },
    ]);
    expect(p).toContain("### 文档 1：部署规范");
    expect(p).toContain("[文档内容已截断]");
    expect(p).toContain("### 文档 2：回滚手册");
    expect(p).not.toContain("b".repeat(10) + "\n\n[文档内容已截断]");
    expect(p).toContain("请基于上述文档回答用户问题");
  });
});

describe("knowledge-extract", () => {
  it("来源类型映射中文标签，未知来源回退“来源”", () => {
    expect(buildKnowledgeExtractPrompt("meeting", "纪要")).toContain("会议纪要");
    expect(buildKnowledgeExtractPrompt("chat", "记录")).toContain("聊天记录");
    expect(buildKnowledgeExtractPrompt("task", "描述")).toContain("任务描述");
    expect(buildKnowledgeExtractPrompt("unknown", "内容")).toContain("从给定的来源中提取");
  });

  it("声明节点类型与关系类型契约", () => {
    const p = buildKnowledgeExtractPrompt("document", "正文");
    expect(p).toContain('"nodes"');
    expect(p).toContain('"edges"');
    for (const t of ["concept", "entity", "fact", "procedure"]) {
      expect(p).toContain(t);
    }
    for (const r of ["depends_on", "relates_to", "part_of", "authored_by"]) {
      expect(p).toContain(r);
    }
  });

  it("超长来源内容截断（>8000）且可注入反馈示例", () => {
    const p = buildKnowledgeExtractPrompt("document", "x".repeat(8001), shot);
    expect(p).toContain("[内容已截断]");
    expect(p).toContain("## 参考示例");
    const ok = buildKnowledgeExtractPrompt("document", "x".repeat(8000));
    expect(ok).not.toContain("[内容已截断]");
  });
});

describe("knowledge-qa", () => {
  it("system prompt 列出可用模块并约束 Markdown 输出", () => {
    const p = buildKnowledgeQaSystemPrompt();
    expect(p).toContain("企业知识助手");
    for (const m of ["任务", "文档", "会议", "审批", "OKR", "Wiki"]) {
      expect(p).toContain(m);
    }
    expect(p).toContain("不要输出 JSON");
  });

  it("feedback 示例可注入", () => {
    expect(buildKnowledgeQaSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("user prompt 拼接问题与上下文并截断（12000）", () => {
    const p = buildKnowledgeQaUserPrompt("本周任务", "- 进行中 2 项");
    expect(p.startsWith("## 用户问题\n本周任务\n\n## 工作区上下文数据\n")).toBe(true);
    const long = buildKnowledgeQaUserPrompt("Q", "x".repeat(12001));
    expect(long).toContain("[上下文已截断]");
  });
});

describe("mail-assistant", () => {
  it("起草系统提示声明邮件 Markdown 结构", () => {
    const p = buildMailDraftSystemPrompt();
    expect(p).toContain("商务邮件起草助手");
    expect(p).toContain("# 主题");
    expect(p).toContain("此致 敬礼");
  });

  it("起草用户提示：描述截断 4000、可选拼接上下文", () => {
    const basic = buildMailDraftUserPrompt("通知周会");
    expect(basic.startsWith("## 邮件需求描述\n通知周会")).toBe(true);
    expect(basic).not.toContain("## 上下文");
    expect(buildMailDraftUserPrompt("d".repeat(4001))).toContain("[描述已截断]");
    const withCtx = buildMailDraftUserPrompt("通知周会", "收件人：全组");
    expect(withCtx).toContain("## 上下文\n收件人：全组");
    expect(buildMailDraftUserPrompt("通知周会", "c".repeat(4001))).toContain("[上下文已截断]");
  });

  it("摘要：系统提示要求要点列表，用户提示 12000 截断", () => {
    expect(buildMailSummarizeSystemPrompt()).toContain("邮件摘要助手");
    expect(buildMailSummarizeSystemPrompt(shot)).toContain("## 参考示例");
    const p = buildMailSummarizeUserPrompt("邮件正文");
    expect(p.startsWith("## 邮件内容\n邮件正文")).toBe(true);
    expect(buildMailSummarizeUserPrompt("x".repeat(12001))).toContain("[邮件内容已截断]");
  });

  it("分类：五种类别枚举与 8000 截断", () => {
    const p = buildMailClassifySystemPrompt();
    expect(p).toContain("邮件分类助手");
    expect(p).toContain('"category": "work|notice|personal|urgent|other"');
    expect(p).toContain('"confidence"');
    expect(buildMailClassifySystemPrompt(shot)).toContain("## 参考示例");
    const u = buildMailClassifyUserPrompt("x".repeat(8001));
    expect(u).toContain("[邮件内容已截断]");
    expect(u.startsWith("## 邮件内容")).toBe(true);
  });

  it("回复建议：三语气契约与原文 8000 截断 + 可选上下文", () => {
    const p = buildMailReplySystemPrompt();
    expect(p).toContain("邮件回复建议助手");
    expect(p).toContain('"tone": "formal"');
    expect(p).toContain("casual");
    expect(p).toContain("concise");
    const noCtx = buildMailReplyUserPrompt("请周五前提交");
    expect(noCtx.startsWith("## 原邮件内容\n请周五前提交")).toBe(true);
    expect(noCtx).not.toContain("## 上下文");
    expect(buildMailReplyUserPrompt("x".repeat(8001))).toContain("[原邮件已截断]");
    const withCtx = buildMailReplyUserPrompt("请周五前提交", "历史：已催一次");
    expect(withCtx).toContain("## 上下文\n历史：已催一次");
  });
});

describe("meeting-flow", () => {
  it("会前系统提示声明议程 JSON 契约", () => {
    const p = buildPreMeetingSystemPrompt();
    expect(p).toContain("会议规划助手");
    expect(p).toContain("suggestedAgenda");
    expect(p).toContain("suggestedDuration");
    expect(p).toContain("expectedOutputs");
    expect(buildPreMeetingSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("会前用户提示拼接议程与可选拓展参与者", () => {
    expect(buildPreMeetingPrompt({ agenda: "Q3 规划" })).toBe("议程描述：Q3 规划");
    expect(buildPreMeetingPrompt({ agenda: "Q3 规划", participants: ["张三", "李四"] })).toBe(
      "议程描述：Q3 规划\n参与者：张三, 李四",
    );
    expect(buildPreMeetingPrompt({ agenda: "Q3 规划", participants: [] })).not.toContain("参与者");
  });

  it("会后系统提示含四段式纪要示例", () => {
    const p = buildPostMeetingSystemPrompt();
    expect(p).toContain("会议纪要生成助手");
    for (const s of ["会议摘要", "关键讨论", "决策事项", "行动项"]) {
      expect(p).toContain(`## ${s}`);
    }
    expect(buildPostMeetingSystemPrompt(shot)).toContain("## 参考示例");
  });

  it("会后用户提示截断超长转录（>15000）", () => {
    expect(buildPostMeetingPrompt("t".repeat(15001))).toContain("[... 转录文本已截断 ...]");
    expect(buildPostMeetingPrompt("t".repeat(15000))).not.toContain("转录文本已截断");
  });
});

describe("personalization", () => {
  it("系统提示声明三类推荐与 JSON 契约", () => {
    const p = buildPersonalizationSystemPrompt();
    expect(p).toContain("个性化推荐引擎");
    expect(p).toContain("capability_recommendation");
    expect(p).toContain("prompt_optimization");
    expect(p).toContain("workflow_suggestion");
    expect(p).toContain('"recommendations"');
    expect(p).toContain('"description"');
    expect(p).toContain('"suggestion"');
    expect(p).toContain('"reason"');
  });

  it("无行为记录走空推荐分支", () => {
    const p = buildPersonalizationPrompt([], "capability_recommendation");
    expect(p).toContain("## 用户行为数据\n无行为记录");
    expect(p).toContain("## 推荐类型\ncapability_recommendation");
    expect(p).toContain("可返回空 recommendations 数组");
  });

  it("行为统计按能力/行为类型分组并按频次降序", () => {
    const p = buildPersonalizationPrompt(
      [
        behavior("task-breakdown", "use_capability", new Date("2026-09-01T10:00:00Z")),
        behavior("task-breakdown", "use_capability", new Date("2026-09-01T11:00:00Z")),
        behavior("doc-qa", "use_capability", new Date("2026-09-02T10:00:00Z")),
        behavior("task-breakdown", "accept_suggestion", new Date("2026-09-02T11:00:00Z")),
      ],
      "workflow_suggestion",
    );
    expect(p).toContain("**按能力分组：**");
    // 频次降序：task-breakdown 3 次在前，doc-qa 1 次在后
    expect(p.indexOf("- task-breakdown: 3 次")).toBeLessThan(p.indexOf("- doc-qa: 1 次"));
    expect(p).toContain("**按行为类型分组：**");
    expect(p.indexOf("- use_capability: 3 次")).toBeLessThan(
      p.indexOf("- accept_suggestion: 1 次"),
    );
    expect(p).toContain("## 推荐类型\nworkflow_suggestion");
    expect(p).toContain("最近行为明细（最多 30 条）");
  });

  it("行为明细含 ISO 时间、能力与 metadata 序列化", () => {
    const ts = new Date("2026-09-01T10:00:00Z");
    const p = buildPersonalizationPrompt(
      [behavior("task-breakdown", "use_capability", ts, { source: "panel" })],
      "prompt_optimization",
    );
    expect(p).toContain(
      `- ${ts.toISOString()} | action=use_capability | capability=task-breakdown`,
    );
    expect(p).toContain('(metadata: {"source":"panel"})');
    // metadata 为 null 时不输出 metadata 段
    const noMeta = buildPersonalizationPrompt(
      [behavior("task-breakdown", "use_capability", ts)],
      "prompt_optimization",
    );
    expect(noMeta).not.toContain("(metadata:");
  });

  it("行为明细最多保留 30 条", () => {
    const behaviors = Array.from({ length: 35 }, (_, i) =>
      behavior("doc-qa", "use_capability", new Date(2026, 8, 1, 10, i)),
    );
    const p = buildPersonalizationPrompt(behaviors, "capability_recommendation");
    const detailSection = p.split("### 最近行为明细（最多 30 条）")[1] ?? "";
    const detailLines = detailSection.split("\n").filter((l) => l.startsWith("- "));
    expect(detailLines).toHaveLength(30);
  });
});
