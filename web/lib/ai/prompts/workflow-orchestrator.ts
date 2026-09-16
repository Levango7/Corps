// AI 工作流编排 prompt 模板——自然语言描述 → 完整工作流定义。
//
// AI 分析用户的自然语言描述（如"当任务完成时通知负责人并创建跟进任务"），
// 自动生成包含触发器、节点列表、连接关系的完整工作流定义，
// 并附上自然语言解释。
//
// 节点类型：
//   - action：执行操作（发通知 / 创建任务 / 更新状态等）
//   - condition：条件判断分支
//   - loop：循环遍历
//   - parallel：并行执行
//   - approval：人工审批节点
//
// 返回 JSON：
// {
//   "trigger": { "event": "...", "conditions": ["..."] },
//   "nodes": [{ "id": "...", "type": "...", "name": "...", "config": {} }],
//   "edges": [{ "from": "...", "to": "...", "label": "..." }],
//   "explanation": "..."
// }

/** 已有工作流的摘要信息（供 AI 参考，避免重复 / 基于已有增强） */
export interface ExistingWorkflowSummary {
  name: string;
  triggerEvent: string;
  nodeCount: number;
}

/**
 * 构造工作流编排系统提示。
 *
 * 引导 AI 从自然语言描述生成结构化工作流定义：
 * - trigger：触发事件 + 触发条件列表
 * - nodes：节点列表，每个节点有唯一 id、类型、名称、配置
 * - edges：节点间连接关系，支持条件分支标签
 * - explanation：工作流的自然语言解释
 *
 * @param existingWorkflows 已有工作流摘要（可选），供 AI 参考避免重复
 */
export function buildWorkflowOrchestratorSystemPrompt(
  existingWorkflows?: ExistingWorkflowSummary[],
): string {
  const existingSection =
    existingWorkflows && existingWorkflows.length > 0
      ? `\n\n## 已有工作流\n当前工作区已有以下工作流，生成时请避免重复，可基于已有工作流增强或补充：\n${existingWorkflows
          .map(
            (w, i) =>
              `${i + 1}. ${w.name}（触发事件：${w.triggerEvent}，${w.nodeCount} 个节点）`,
          )
          .join("\n")}\n`
      : "";

  return `你是工作流编排专家。根据用户的自然语言描述，生成完整的结构化工作流定义。

工作流由以下部分组成：

1. **触发器（trigger）**：定义工作流何时启动
   - event：触发事件类型，如 task.completed / task.created / document.published / approval.submitted / schedule.daily / manual / im.message_received 等
   - conditions：触发条件的字符串数组，如 ["task.priority == 'urgent'"]、["document.category == 'contract'"]，无条件时为空数组

2. **节点列表（nodes）**：工作流执行步骤，每个节点有：
   - id：唯一标识符，如 "node-1"、"node-2"（trigger 不算节点，节点从触发后第一步开始）
   - type：节点类型，必须是以下之一：
     * "action"：执行操作（发通知 / 创建任务 / 更新状态 / 发送消息 / 调用 API 等）
     * "condition"：条件判断，根据条件走不同分支
     * "loop"：循环遍历集合，对每个元素执行子操作
     * "parallel"：并行执行多个子操作
     * "approval"：人工审批节点，暂停等待指定角色审批
   - name：节点显示名称（简洁中文描述）
   - config：节点配置对象，不同 type 有不同字段（见下方示例）

3. **连接关系（edges）**：节点间流转关系
   - from：源节点 id
   - to：目标节点 id
   - label：可选，条件分支标签（如 "通过"、"驳回"、"是"、"否"）

4. **解释（explanation）**：用自然语言描述整个工作流的执行流程，方便用户理解确认

返回 JSON 格式：
{
  "trigger": {
    "event": "task.completed",
    "conditions": ["task.priority in ['high', 'urgent']"]
  },
  "nodes": [
    {
      "id": "node-1",
      "type": "action",
      "name": "通知负责人",
      "config": {
        "actionType": "notify",
        "target": "task.assignee",
        "message": "任务「{task.title}」已完成"
      }
    },
    {
      "id": "node-2",
      "type": "approval",
      "name": "负责人确认",
      "config": {
        "approver": "task.assignee",
        "timeout": "24h"
      }
    },
    {
      "id": "node-3",
      "type": "action",
      "name": "创建跟进任务",
      "config": {
        "actionType": "createTask",
        "title": "跟进：{task.title}",
        "assignee": "task.assignee"
      }
    }
  ],
  "edges": [
    { "from": "node-1", "to": "node-2" },
    { "from": "node-2", "to": "node-3", "label": "通过" }
  ],
  "explanation": "当高优或紧急任务完成时，先通知负责人，然后等待负责人在 24 小时内审批；审批通过后自动创建一个跟进任务并指派给原负责人。"
}

规则：
1. trigger.event 必须是合法的事件类型字符串
2. nodes 数组至少包含 1 个节点，最多 10 个节点
3. 每个节点的 id 必须唯一，type 必须是 action/condition/loop/parallel/approval 之一
4. edges 必须形成合法的流转关系，from 和 to 必须引用存在的节点 id
5. condition 类型节点应在 edges 中通过 label 区分不同分支
6. approval 类型节点必须有 config.approver 字段
7. explanation 用简洁的自然语言描述整个流程，不超过 300 字符
8. 只返回 JSON，不要包含 markdown 代码块标记或其他文字
${existingSection}
## 推理步骤
生成前请依次分析：
1. 用户的描述中，触发条件是什么？对应哪个事件类型？
2. 需要哪些执行步骤？每步是什么类型的节点？
3. 步骤之间是顺序、条件分支、循环还是并行关系？
4. 是否需要人工审批环节？
5. 如何用 edges 表达节点间的流转和分支？

## 输出格式
只返回合法 JSON，不要包含 markdown 代码块标记或其他文字。

## 示例
输入：当任务完成时通知负责人并创建跟进任务
输出：
{"trigger":{"event":"task.completed","conditions":[]},"nodes":[{"id":"node-1","type":"action","name":"通知负责人","config":{"actionType":"notify","target":"task.assignee","message":"任务「{task.title}」已完成"}},{"id":"node-2","type":"action","name":"创建跟进任务","config":{"actionType":"createTask","title":"跟进：{task.title}","assignee":"task.assignee"}}],"edges":[{"from":"node-1","to":"node-2"}],"explanation":"当任务完成时，先通知负责人，然后自动创建一个跟进任务并指派给原负责人。"}

输入：合同文档发布后需要法务审批，通过则归档，驳回则通知作者修改
输出：
{"trigger":{"event":"document.published","conditions":["document.category == 'contract'"]},"nodes":[{"id":"node-1","type":"approval","name":"法务审批","config":{"approver":"role:legal","timeout":"48h"}},{"id":"node-2","type":"action","name":"归档文档","config":{"actionType":"archive","target":"document.id"}},{"id":"node-3","type":"action","name":"通知作者修改","config":{"actionType":"notify","target":"document.author","message":"文档「{document.title}」审批未通过，请修改后重新提交"}}],"edges":[{"from":"node-1","to":"node-2","label":"通过"},{"from":"node-1","to":"node-3","label":"驳回"}],"explanation":"当合同类文档发布后，提交法务在 48 小时内审批；审批通过则自动归档文档，驳回则通知作者修改后重新提交。"}

输入：每天检查所有逾期任务，对每个任务通知负责人并标记为紧急
输出：
{"trigger":{"event":"schedule.daily","conditions":["time == '09:00'"]},"nodes":[{"id":"node-1","type":"loop","name":"遍历逾期任务","config":{"iterate":"overdueTasks","itemVar":"task"}},{"id":"node-2","type":"action","name":"通知负责人","config":{"actionType":"notify","target":"task.assignee","message":"任务「{task.title}」已逾期"}},{"id":"node-3","type":"action","name":"标记为紧急","config":{"actionType":"updateTask","field":"priority","value":"urgent"}}],"edges":[{"from":"node-1","to":"node-2"},{"from":"node-2","to":"node-3"}],"explanation":"每天 9 点检查所有逾期任务，对每个逾期任务依次通知负责人并将优先级标记为紧急。"}`;
}

/**
 * 构造工作流编排用户提示，包含用户的自然语言描述。
 *
 * @param description 用户输入的工作流自然语言描述（已 trim，1-2000 字符）
 */
export function buildWorkflowOrchestratorUserPrompt(description: string): string {
  return `用户想要的工作流描述：${description}\n\n请分析描述并生成完整的工作流定义。`;
}