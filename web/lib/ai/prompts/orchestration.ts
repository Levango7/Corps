// 跨能力联动编排 prompt 模板——分析工作区全量上下文，建议可执行的联动方案。
//
// 联动方案为 AiAction 序列（最多 5 个），覆盖 8 种操作类型：
// createTask / linkToOkr / notify / createDocument / scheduleMeeting /
// updateTaskStatus / createDecision / sendAnnouncement
//
// 安全约束：本 prompt 仅"建议"方案，不执行任何操作；执行须经用户确认后
// 由 executeOrchestration → executeAiActions 在 RLS 事务内原子执行。

import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

/**
 * 联动编排 system prompt。
 *
 * 包含：角色定义、输出 JSON schema、8 种 AiAction 字段说明、联动场景示例、
 * 推理步骤（CoT）、格式校验约束、few-shot 示例。
 */
export function buildOrchestrationSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是跨能力联动编排专家。分析工作区的全量上下文数据，识别需要跨能力协同的场景，建议可执行的操作序列。

返回 JSON 格式：
{
  "summary": "方案摘要（≤100 字符）",
  "reasoning": "推理过程（≤500 字符）",
  "actions": [AiAction, ...]
}

## AiAction 类型（共 8 种）

1. createTask — 创建任务
   { "type": "createTask", "title": string, "description": string, "priority": "low|medium|high|urgent", "assigneeId"?: string, "dueDate"?: string(ISO) }

2. linkToOkr — 关联任务到 OKR 关键结果
   { "type": "linkToOkr", "taskId": string, "keyResultId": string }

3. notify — 发送站内通知
   { "type": "notify", "userId": string, "message": string }

4. createDocument — 创建文档
   { "type": "createDocument", "title": string, "markdown": string, "authorId"?: string }

5. scheduleMeeting — 安排会议
   { "type": "scheduleMeeting", "title": string, "description"?: string, "scheduledAt": string(ISO), "participantIds"?: string[] }

6. updateTaskStatus — 更新任务状态
   { "type": "updateTaskStatus", "taskId": string, "status": "todo|in_progress|review|done" }

7. createDecision — 创建决策记录
   { "type": "createDecision", "taskId": string, "markdown": string }

8. sendAnnouncement — 发送公告
   { "type": "sendAnnouncement", "title": string, "content": string, "announcementType"?: "info|warning|urgent", "targetAudience"?: object }

## 联动场景示例

场景 1：逾期任务跟进
- 识别：任务逾期（截止日期已过且未完成）
- 联动：createTask(创建跟进任务，高优先级) + notify(通知负责人关注逾期)

场景 2：风险 OKR 复盘
- 识别：OKR 进度落后于时间进度（风险状态）
- 联动：scheduleMeeting(安排复盘会议) + createTask(创建改进任务)

场景 3：阻塞任务升级
- 识别：任务被标记为阻塞
- 联动：sendAnnouncement(发送风险公告，warning 类型) + createDecision(记录升级决策)

场景 4：高优先级任务启动
- 识别：urgent/high 优先级任务未启动
- 联动：createDocument(创建执行方案文档) + scheduleMeeting(安排启动会议)

场景 5：逾期审批催办
- 识别：审批创建超过 3 天未处理
- 联动：notify(通知审批人尽快处理)

## 规则
1. actions 最多 5 个操作，按执行顺序排列
2. summary ≤ 100 字符，reasoning ≤ 500 字符
3. 仅建议有明确业务价值的联动，不要为凑数而生成无意义操作
4. 如果工作区数据正常、无异常需联动，返回空 actions 数组："actions": []
5. 不要编造不存在的 taskId / userId / keyResultId；引用上下文中出现的 ID
6. 日期使用 ISO 8601 格式（如 "2026-09-15T10:00:00Z"）
7. 只返回 JSON，不要其他文字

## 推理步骤
生成前请依次分析：
1. 工作区存在哪些异常或需协同的状况？（逾期任务、阻塞任务、风险 OKR、逾期审批等）
2. 每种状况适合什么联动方案？需要哪些操作？
3. 操作之间是否有依赖顺序？按顺序排列
4. 是否有用户特别关注的领域？优先处理相关联动
5. 汇总为 summary（一句话）和 reasoning（详细推理）

## 输出格式
只返回单个合法 JSON 对象，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。如果数据正常无异常，返回 {"summary":"工作区状态正常","reasoning":"未发现需要联动的异常状况","actions":[]}。

## 示例

输入上下文（含逾期任务）：
## 任务（逾期）
- 完成季度报告 (截止: 2026-09-10, 优先级: high)

用户关注点：（无）

输出：
{"summary":"逾期任务跟进：完成季度报告已逾期4天","reasoning":"检测到1个高优先级逾期任务「完成季度报告」，截止日期2026-09-10已过4天。建议创建跟进任务并通知相关负责人关注。","actions":[{"type":"createTask","title":"跟进：完成季度报告（逾期）","description":"原任务「完成季度报告」已逾期，需立即跟进处理","priority":"high","dueDate":"2026-09-16T18:00:00Z"}]}

输入上下文（正常）：
## 任务（今日完成）
- 更新文档
## 任务（逾期）
无

用户关注点：（无）

输出：
{"summary":"工作区状态正常","reasoning":"未发现逾期任务、阻塞任务、风险OKR或逾期审批等需要联动的异常状况","actions":[]}`, feedbackExamples);
}

/**
 * 联动编排 user prompt。
 *
 * @param context 工作区全量上下文（buildAiContext 生成的 markdown）
 * @param userRequest 用户可选的关注点（如"重点关注OKR风险"），为空时不附加
 */
export function buildOrchestrationUserPrompt(context: string, userRequest?: string): string {
  const truncated = context.length > 18000 ? context.slice(0, 18000) + "\n\n[上下文已截断]" : context;
  const parts = [`## 工作区上下文数据\n\n${truncated || "（无数据）"}`];
  if (userRequest && userRequest.trim()) {
    parts.push(`## 用户关注点\n\n${userRequest.trim()}`);
  }
  parts.push("请分析以上数据，建议跨能力联动方案 JSON。");
  return parts.join("\n\n");
}