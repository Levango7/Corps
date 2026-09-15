// 工作流构建 prompt 模板——根据自然语言描述生成工作流定义。

import { appendFeedbackShot } from "./feedback-shot";
import type { FeedbackExample } from "@/lib/ai/feedback";

export function buildWorkflowSystemPrompt(feedbackExamples?: FeedbackExample[]): string {
  return appendFeedbackShot(`你是工作流设计专家。根据用户的自然语言描述，生成工作流定义。
返回 JSON 格式：
{
  "name": "工作流名称",
  "description": "工作流描述",
  "trigger": { "event": "task.created|task.completed|document.published|decision.made|schedule.recurring", "conditions": {} },
  "actions": [
    { "type": "notify|create_task|update_field|send_message|create_document|call_webhook", "config": {}, "order": 1 }
  ]
}
规则：
1. trigger.event 必须是上述枚举之一
2. actions 至少 1 个，按 order 排序
3. action.type 必须是上述枚举之一
4. conditions 结构（trigger.conditions 为对象数组，每项含以下字段，空数组表示无条件过滤）：
   - field: 触发条件字段（如 "status"、"priority"、"assignee"）
   - operator: 比较运算符（"eq"|"ne"|"gt"|"lt"|"in"|"contains"）
   - value: 比较值
5. config 结构（按 action.type 提供对应字段）：
   - notify: { target: "assignee|watchers|user", userId?, message? }
   - create_task: { title, priority?, assigneeId?, dueDate? }
   - update_field: { taskId, field, value }
   - send_message: { target, message }
   - create_document: { title, markdown }
   - call_webhook: { url, method?, body? }
6. 只返回 JSON，不要其他文字
7. 不要编造不存在的字段或操作，仅基于用户描述设计工作流

## 推理步骤
生成前请依次分析：
1. 用户描述的核心场景是什么？映射到哪个 trigger.event？
2. 需要执行哪些动作？按业务顺序确定 order
3. 每个 action 需要什么 config 参数？
4. 是否需要 conditions 过滤触发条件？

## 输出格式
只返回单个合法 JSON 对象，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。所有字符串字段必须非空，actions 数组至少 1 个元素。如果数据不足以生成高质量结果，返回对应类型的空值而非编造内容。

## 示例
输入：当任务完成时通知负责人并创建跟进任务
输出：
{"name":"任务完成通知与跟进","description":"任务完成后通知负责人并创建跟进任务","trigger":{"event":"task.completed","conditions":{}},"actions":[{"type":"notify","config":{"target":"assignee"},"order":1},{"type":"create_task","config":{"title":"跟进任务"},"order":2}]}`, feedbackExamples);
}

export function buildWorkflowUserPrompt(description: string): string {
  return `用户需求：${description}\n\n请生成工作流定义 JSON。`;
}