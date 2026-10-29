// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildAnnouncementSystemPrompt,
  buildAnnouncementUserPrompt,
} from "@/lib/ai/prompts/announcement-draft";
import {
  buildApprovalAdviceSystemPrompt,
  buildUserPrompt as buildApprovalAdviceUserPrompt,
} from "@/lib/ai/prompts/approval-advice";
import {
  buildCalendarSystemPrompt,
  buildCalendarUserPrompt,
  type CalendarScheduleInput,
} from "@/lib/ai/prompts/calendar-schedule";
import {
  buildTodoExtractSystemPrompt,
  buildTodoExtractUserPrompt,
  type TodoExtractSource,
} from "@/lib/ai/prompts/todo-extract";
import {
  buildMeetingSummarySystemPrompt,
  buildMeetingSummaryUserPrompt,
} from "@/lib/ai/prompts/meeting-summary";
import { buildImReplySystemPrompt, buildImReplyUserPrompt } from "@/lib/ai/prompts/im-reply";

/**
 * 六个 AI 能力 prompt builder 的契约测试（公告 / 审批风控 / 日历排程 /
 * 待办提取 / 会议纪要 / IM 智能回复）。
 *
 * 这些 builder 此前零行覆盖（scripts/zero-coverage-baseline.txt）。每个 builder
 * 的风险点不在 happy path，而在**边界分支**：超长上下文截断、空上下文兜底、
 * 可选输入滤除、源类型映射——这些分支一旦改错，对应能力会静默退化为无上下文调用。
 * system prompt 侧钉的是输出契约（JSON schema / 枚举 / markdown 约束），
 * 因为下游解析器严格按这些约定 reject 输出。
 */

describe("announcement-draft", () => {
  it("system prompt 声明 Markdown 输出契约与起草规则", () => {
    const p = buildAnnouncementSystemPrompt();
    expect(p).toContain("你是企业公告起草助手");
    expect(p).toContain("# 标题");
    expect(p).toContain("Markdown");
    // 公告是面向全员的内容面：编造禁令必须在
    expect(p).toContain("不要编造");
  });

  it("user prompt 带主题时前置公告主题段", () => {
    const p = buildAnnouncementUserPrompt("近期完成了 v2.3 上线", "版本 v2.3 上线");
    expect(p.indexOf("## 公告主题")).toBeLessThan(p.indexOf("## 工作区近期上下文"));
    expect(p).toContain("版本 v2.3 上线");
  });

  it("user prompt 无主题时不出现空主题段", () => {
    expect(buildAnnouncementUserPrompt("上下文")).not.toContain("## 公告主题");
  });

  it("超过 12000 字符的上下文截断并标注", () => {
    const p = buildAnnouncementUserPrompt("y".repeat(13000));
    expect(p).toContain("[上下文已截断]");
    expect(p).not.toContain("y".repeat(12001));
  });
});

describe("approval-advice", () => {
  it("system prompt 声明 riskLevel 三档枚举与 JSON 输出契约", () => {
    const p = buildApprovalAdviceSystemPrompt();
    expect(p).toContain('"riskLevel"');
    for (const lvl of ["low", "medium", "high"]) expect(p).toContain(lvl);
    expect(p).toContain("similarCases");
    // 风控建议的权责边界：不替审批人做决定
    expect(p).toContain("不替审批人做决定");
  });

  it("user prompt 以审批数据前缀注入上下文", () => {
    expect(buildApprovalAdviceUserPrompt("采购申请 50000 元")).toContain(
      "审批数据：\n采购申请 50000 元",
    );
  });

  it("超过 12000 字符的上下文截断并标注", () => {
    const p = buildApprovalAdviceUserPrompt("z".repeat(13000));
    expect(p).toContain("[上下文已截断]");
  });
});

describe("calendar-schedule", () => {
  it("system prompt 声明 suggestions JSON schema 与 1-3 个方案约束", () => {
    const p = buildCalendarSystemPrompt();
    expect(p).toContain('"suggestions"');
    expect(p).toContain('"startTime"');
    expect(p).toContain('"conflicts"');
    expect(p).toContain("1-3 个");
    expect(p).toContain("ISO 8601");
  });

  it("user prompt 包含描述、时长、参与人员三行", () => {
    const p = buildCalendarUserPrompt("日历上下文", {
      description: "下周二下午开产品评审会",
      duration: 120,
      attendees: ["张三", "李四"],
    } satisfies CalendarScheduleInput);
    expect(p).toContain("排程需求：下周二下午开产品评审会");
    expect(p).toContain("期望时长：120 分钟");
    expect(p).toContain("参与人员：张三、李四");
    expect(p).toContain("工作区日历上下文：");
  });

  it("可选字段缺失时自动滤除，不留空行", () => {
    const p = buildCalendarUserPrompt("日历", { description: "开个会", attendees: [] });
    expect(p).not.toContain("期望时长");
    expect(p).not.toContain("参与人员");
    expect(p).toContain("排程需求：开个会");
  });
});

describe("todo-extract", () => {
  it("system prompt 声明优先级四档与 confidence 数值约定", () => {
    const p = buildTodoExtractSystemPrompt();
    for (const lvl of ["urgent", "high", "medium", "low"]) expect(p).toContain(lvl);
    expect(p).toContain("confidence");
    expect(p).toContain("0-1");
  });

  it("源类型映射为中文标签：message→消息 / document→文档 / email→邮件", () => {
    expect(buildTodoExtractUserPrompt("message", "内容")).toContain("源类型：消息");
    expect(buildTodoExtractUserPrompt("document", "内容")).toContain("源类型：文档");
    expect(buildTodoExtractUserPrompt("email", "内容")).toContain("源类型：邮件");
  });

  it("带候选人列表时附匹配段，空列表不附", () => {
    const withList = buildTodoExtractUserPrompt("message", "内容", {
      assignees: ["张三", "李四"],
    });
    expect(withList).toContain("候选人列表（用于匹配负责人）：张三、李四");
    expect(buildTodoExtractUserPrompt("message", "内容", { assignees: [] })).not.toContain(
      "候选人列表",
    );
    expect(buildTodoExtractUserPrompt("message", "内容")).not.toContain("候选人列表");
  });

  it("原样注入源文本内容", () => {
    expect(buildTodoExtractUserPrompt("email" as TodoExtractSource, "明天前交报告")).toContain(
      "明天前交报告",
    );
  });
});

describe("meeting-summary", () => {
  it("system prompt 声明纪要 JSON schema 与各列表上界", () => {
    const p = buildMeetingSummarySystemPrompt();
    expect(p).toContain('"keyPoints"');
    expect(p).toContain('"decisions"');
    expect(p).toContain('"actionItems"');
    expect(p).toContain('"participants"');
    // 推断禁令：模糊时间不得推断成 dueDate（与 normalizePlan 的严格校验同向）
    expect(p).toContain("不要推断模糊的时间表述");
  });

  it("user prompt 带会议标题时前置标题行", () => {
    const p = buildMeetingSummaryUserPrompt("张三: 大家好", "季度经营会");
    expect(p.startsWith("会议标题：季度经营会")).toBe(true);
  });

  it("空白标题不前置（判据是 trim 后非空）", () => {
    const p = buildMeetingSummaryUserPrompt("张三: 大家好", "   ");
    expect(p.startsWith("会议转写文本")).toBe(true);
  });

  it("超过 30000 字符的转写截断并标注", () => {
    const long = "发言人: 内容\n".repeat(4000); // 32000 字符，越过 30000 截断线
    const p = buildMeetingSummaryUserPrompt(long);
    expect(p).toContain("[... 转录文本已截断 ...]");
  });
});

describe("im-reply", () => {
  it("system prompt 声明 3 条回复与三档 tone 枚举", () => {
    const p = buildImReplySystemPrompt();
    expect(p).toContain("生成 3 个");
    for (const tone of ["formal", "casual", "concise"]) expect(p).toContain(tone);
    expect(p).toContain("200 字");
  });

  it("user prompt 格式化消息为 [时间] 作者: 正文", () => {
    const p = buildImReplyUserPrompt([
      { author: "张三", body: "今天的报告交了吗？", createdAt: "10:00" },
    ]);
    expect(p).toContain("[10:00] 张三: 今天的报告交了吗？");
    expect(p).toContain("请生成 3 个回复建议");
  });

  it("单条消息超过 500 字符截断并标注", () => {
    const p = buildImReplyUserPrompt([
      { author: "张三", body: "a".repeat(600), createdAt: "10:00" },
    ]);
    expect(p).toContain("a".repeat(500) + "[...已截断]");
    expect(p).not.toContain("a".repeat(501) + "[");
  });

  it("整体聊天记录超过 12000 字符截断并标注", () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({
      author: `u${i}`,
      body: "b".repeat(400),
      createdAt: "10:00",
    })); // 40 * 400+ ≈ 17000 字符
    const p = buildImReplyUserPrompt(msgs);
    expect(p).toContain("[聊天记录已截断]");
  });
});
