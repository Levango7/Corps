// AI 邮件助手 prompt 模板——支持邮件起草 / 摘要 / 分类 / 回复建议四种能力。
//
// 设计要点：
// - 起草（draft）：流式生成专业商务邮件正文，输出 Markdown
// - 摘要（summarize）：要点列表格式，保留核心信息
// - 分类（classify）：返回 JSON { category, confidence, reason }，使用 reasoner 模型
// - 回复（reply）：返回 JSON 数组 [{ text, tone }]，3 个不同语气的回复建议
//
// 与 im-reply / announcement-draft 等 prompt 保持一致的结构：
//  - 系统提示含规则 + 推理步骤 + 输出格式 + 示例
//  - 用户提示含截断保护（避免 prompt 膨胀）
//  - 通过 appendFeedbackShot 注入 few-shot 反馈示例（可选）

import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

// ─── 邮件起草 ───

/**
 * 邮件起草系统提示：生成专业商务邮件正文。
 *
 * 输出 Markdown 格式邮件，包含：
 *  - 邮件主题（# 主题）
 *  - 称呼 / 正文 / 落款分段
 *  - 突出关键信息，语气正式但友好
 *
 * @param feedbackExamples 可选的正面反馈示例（few-shot）
 */
export function buildMailDraftSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是专业商务邮件起草助手。根据用户描述生成完整邮件正文。
输出 Markdown 格式邮件，包含：
1. 邮件主题（以 # 开头）
2. 称呼（如"您好，"）
3. 正文（分段清晰，逻辑连贯）
4. 落款（如"此致 敬礼"）

规则：
1. 基于用户描述生成，不要编造未提及的信息
2. 语气正式但友好，符合商务场景
3. 突出关键信息，避免冗余
4. 中文输出
5. 总长度不超过 800 字

## 推理步骤
起草前请依次分析：
1. 邮件的核心目的是什么？（通知 / 请求 / 确认 / 邀请 / 致谢）
2. 收件人身份如何？确定称呼与语气正式程度
3. 哪些信息需要突出？哪些可省略？
4. 是否需要明确下一步行动或截止时间？

## 输出格式
使用标准 Markdown 语法，以 # 主题开头，正文分段清晰，不要使用 HTML 标签。如果用户描述不足以生成高质量邮件，返回简短致歉说明而非编造内容。

## 示例
输入：描述"通知团队周一上午 10 点开周会"
输出：
# 周一周会通知
您好，
本周一上午 10 点将召开周会，请准时参加。
会议地点：3 号会议室（线上链接随后同步）。
请提前准备本周工作进展与待办事项。
此致 敬礼`, feedbackExamples);
}

/**
 * 邮件起草用户提示：拼接用户描述与可选上下文。
 *
 * @param description 邮件需求描述（必填）
 * @param context 可选上下文（如收件人信息、相关背景）
 */
export function buildMailDraftUserPrompt(description: string, context?: string): string {
  const truncatedDesc =
    description.length > 4000 ? description.slice(0, 4000) + "\n\n[描述已截断]" : description;
  const ctxPart = context
    ? `\n\n## 上下文\n${context.length > 4000 ? context.slice(0, 4000) + "\n\n[上下文已截断]" : context}`
    : "";
  return `## 邮件需求描述\n${truncatedDesc}${ctxPart}\n\n请基于上述信息起草邮件。`;
}

// ─── 邮件摘要 ───

/**
 * 邮件摘要系统提示：生成要点列表格式的摘要。
 *
 * @param feedbackExamples 可选的正面反馈示例（few-shot）
 */
export function buildMailSummarizeSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是邮件摘要助手。将用户提供的邮件内容生成简洁摘要。
摘要应当：
1) 保留核心观点和关键信息
2) 使用要点列表格式（- xxx）
3) 每个要点不超过一行
4) 总长度不超过原文的 30%
5) 中文输出

## 推理步骤
生成前请依次分析：
1. 邮件的核心主题是什么？
2. 哪些是需要收件人关注的关键信息？（行动项 / 截止时间 / 决策）
3. 哪些是次要的背景信息？
4. 如何用最简洁的语言表达？

## 输出格式
输出 Markdown 要点列表，每行以 "- " 开头。不要包含其他文字或代码块标记。

## 示例
输入：项目验收邮件，含时间地点、所需材料、联系人
输出：
- 验收时间：本周五 14:00，地点 3 号会议室
- 需携带：项目文档、测试报告、签字章
- 联系人：张三（内线 8821）
- 未通过验收需在 3 个工作日内整改`, feedbackExamples);
}

/**
 * 邮件摘要用户提示：拼接邮件内容。
 *
 * @param content 邮件正文
 */
export function buildMailSummarizeUserPrompt(content: string): string {
  const truncated = content.length > 12000 ? content.slice(0, 12000) + "\n\n[邮件内容已截断]" : content;
  return `## 邮件内容\n${truncated}\n\n请生成摘要。`;
}

// ─── 邮件分类 ───

/** 邮件类别枚举（与 API 路由 zod schema 对齐） */
export type MailCategory = "work" | "notice" | "personal" | "urgent" | "other";

/**
 * 邮件分类系统提示：返回 JSON { category, confidence, reason }。
 *
 * 类别说明：
 *  - work：工作相关（项目 / 任务 / 协作）
 *  - notice：通知公告（会议 / 活动 / 制度）
 *  - personal：私人事务（问候 / 邀请 / 致谢）
 *  - urgent：紧急事项（截止 / 风险 / 故障）
 *  - other：其他
 *
 * @param feedbackExamples 可选的正面反馈示例（few-shot）
 */
export function buildMailClassifySystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是邮件分类助手。根据邮件内容判断类别，并给出置信度与理由。
返回 JSON 格式：
{ "category": "work|notice|personal|urgent|other", "confidence": 0.0-1.0, "reason": "分类理由" }

类别定义：
- work：工作相关（项目 / 任务 / 协作 / 报告）
- notice：通知公告（会议 / 活动 / 制度变更）
- personal：私人事务（问候 / 邀请 / 致谢 / 个人请求）
- urgent：紧急事项（截止时间 / 风险提示 / 故障告警）
- other：以上均不匹配的其他邮件

规则：
1. 仅基于邮件内容判断，不编造未提及的信息
2. confidence 反映分类把握程度（0.0-1.0）
3. reason 简要说明分类依据（不超过 50 字）

## 推理步骤
分类前请依次分析：
1. 邮件的核心主题与关键词是什么？
2. 是否包含紧急标志（截止时间 / 风险词 / 故障词）？
3. 是否属于工作协作场景？还是通知公告 / 私人事务？
4. 综合判断最匹配的类别与置信度。

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。category 必须是 "work" / "notice" / "personal" / "urgent" / "other" 之一，confidence 必须是 0 到 1 之间的数字。

## 示例
输入：项目周报邮件，含本周进展与下周计划
输出：
{"category":"work","confidence":0.95,"reason":"项目周报，含工作进展与计划，属工作协作场景"}`, feedbackExamples);
}

/**
 * 邮件分类用户提示：拼接邮件内容。
 *
 * @param content 邮件正文
 */
export function buildMailClassifyUserPrompt(content: string): string {
  const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n\n[邮件内容已截断]" : content;
  return `## 邮件内容\n${truncated}\n\n请分类。`;
}

// ─── 邮件回复建议 ───

/** 回复语气枚举（与 API 路由 zod schema 对齐） */
export type MailReplyTone = "formal" | "casual" | "concise";

/**
 * 邮件回复建议系统提示：生成 3 个不同语气的回复建议。
 *
 * 返回 JSON 数组 [{ text, tone }]，tone 取值 formal / casual / concise。
 *
 * @param feedbackExamples 可选的正面反馈示例（few-shot）
 */
export function buildMailReplySystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是邮件回复建议助手。根据原邮件内容，生成 3 个不同语气的回复建议。
返回 JSON 数组格式：
[
  { "text": "回复内容1", "tone": "formal" },
  { "text": "回复内容2", "tone": "casual" },
  { "text": "回复内容3", "tone": "concise" }
]

规则：
1. 生成 3 个不同语气的回复（formal / casual / concise）
2. 每条回复不超过 300 字
3. 基于原邮件理解对方意图，给出有针对性的回复
4. 仅基于原邮件内容生成，不编造未提及的信息
5. 回复需可直接发送（含称呼与落款可省略，由用户自行调整）

## 推理步骤
生成前请依次分析：
1. 原邮件的核心意图是什么？（提问 / 通知 / 请求 / 确认 / 拒绝）
2. 对方语气与身份如何？回复应匹配正式程度
3. 是否存在需要确认或跟进的事项？
4. 3 个回复分别采用 formal / casual / concise 哪种表达？

## 输出格式
只返回合法 JSON 数组，最多包含 3 个元素，不要包含 markdown 代码块标记或其他文字。每个 tone 必须是 "formal" / "casual" / "concise" 之一。如果原邮件信息不足以生成高质量回复，可返回少于 3 个但不要编造。

## 示例
输入：邮件"请于本周五前提交项目报告"
输出：
[{"text":"您好，项目报告将于本周五前按时提交，届时请您查阅。","tone":"formal"},{"text":"收到，周五前提交~","tone":"casual"},{"text":"已收到，按期提交。","tone":"concise"}]`, feedbackExamples);
}

/**
 * 邮件回复用户提示：拼接原邮件内容与可选上下文。
 *
 * @param content 原邮件正文
 * @param context 可选上下文（如收件人关系、历史往来）
 */
export function buildMailReplyUserPrompt(content: string, context?: string): string {
  const truncatedContent =
    content.length > 8000 ? content.slice(0, 8000) + "\n\n[原邮件已截断]" : content;
  const ctxPart = context
    ? `\n\n## 上下文\n${context.length > 4000 ? context.slice(0, 4000) + "\n\n[上下文已截断]" : context}`
    : "";
  return `## 原邮件内容\n${truncatedContent}${ctxPart}\n\n请生成 3 个回复建议。`;
}