// 多 Agent 协同 prompt 模板（方向 D）
//
// 提供两个 prompt 构造函数：
// 1. buildAgentCoordinationPrompt — 协调器 prompt，分析任务并分配给各 Agent
// 2. buildAgentResponsePrompt — 单个 Agent 响应 prompt
//
// 协调器输出 JSON：{ assignments: [{ agentName, subtask, reason }] }
// Agent 响应输出 JSON：{ response, handoff }
//   - handoff 为转交其他 Agent 的消息，null 表示无需转交

/** Agent 简要信息（用于协调器 prompt） */
export interface AgentBrief {
  name: string;
  role: string;
  capabilities: string[];
}

/**
 * 协调器 system prompt — 分析任务并分配给各 Agent。
 *
 * 协调器职责：
 *  1. 理解任务整体目标
 *  2. 根据各 Agent 的角色和能力，将任务拆分为子任务
 *  3. 为每个子任务指定最合适的 Agent，并给出分配理由
 *
 * 输出 JSON：{ assignments: [{ agentName, subtask, reason }] }
 *
 * @param agents 参与协调的 Agent 列表
 * @param task 待分配的任务描述
 * @returns system prompt 字符串
 */
export function buildAgentCoordinationPrompt(
  agents: AgentBrief[],
  task: string,
): string {
  const agentLines = agents
    .map(
      (a) =>
        `- ${a.name}（角色: ${a.role}，能力: ${a.capabilities.join(", ") || "通用"}）`,
    )
    .join("\n");

  return `你是多 Agent 协同协调器。分析任务并分配给各 Agent，每个子任务指定一个最合适的 Agent。

## 可用 Agent

${agentLines || "（无可用 Agent）"}

## 待分配任务

${task}

## 输出 JSON 格式

{
  "assignments": [
    {
      "agentName": "Agent 名称（必须与上方列出的 Agent 名称一致）",
      "subtask": "分配给该 Agent 的子任务描述",
      "reason": "分配理由（说明为何该 Agent 适合此子任务）"
    }
  ]
}

## 规则

1. assignments 数组至少 1 个、最多 ${agents.length || 5} 个分配项
2. agentName 必须与上方列出的 Agent 名称完全一致
3. subtask 描述清晰具体，可独立执行
4. reason 简明扼要说明分配理由（≤100 字符）
5. 优先将子任务分配给能力最匹配的 Agent
6. 若任务无法拆分，可将整体任务分配给最合适的单个 Agent
7. 只返回 JSON，不要其他文字

## 推理步骤

生成前请依次分析：
1. 任务的整体目标是什么？需要哪些能力？
2. 每个可用 Agent 的角色和能力分别适合做什么？
3. 任务可以拆分为哪些子任务？每个子任务需要什么能力？
4. 每个子任务分配给哪个 Agent 最合适？为什么？
5. 汇总为 assignments 数组

## 输出格式

只返回单个合法 JSON 对象，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。`;
}

/**
 * 单个 Agent 响应 system prompt — Agent 根据自身角色和消息内容生成响应。
 *
 * Agent 职责：
 *  1. 理解接收到的消息/子任务
 *  2. 结合自身角色和系统提示词生成响应
 *  3. 判断是否需要将部分工作转交其他 Agent（handoff）
 *
 * 输出 JSON：{ response, handoff }
 *   - response: Agent 的响应内容
 *   - handoff: 转交其他 Agent 的消息（null 表示无需转交）
 *
 * @param agentName Agent 名称
 * @param agentRole Agent 角色
 * @param systemPrompt Agent 自身的系统提示词（定义 Agent 专长和行为约束）
 * @param message 接收到的消息/子任务
 * @returns system prompt 字符串
 */
export function buildAgentResponsePrompt(
  agentName: string,
  agentRole: string,
  systemPrompt: string,
  message: string,
): string {
  return `你是 Agent「${agentName}」，角色为「${agentRole}」。

## 你的专属系统提示词

${systemPrompt || "（无专属提示词，按角色默认行为执行）"}

## 接收到的消息

${message}

## 输出 JSON 格式

{
  "response": "你对消息的响应内容（结合自身角色和专长给出专业回答）",
  "handoff": "转交其他 Agent 的消息（null 表示无需转交，字符串表示需要转交）"
}

## 规则

1. response 必填，字符串类型，内容应体现你作为「${agentRole}」的专业能力
2. handoff 为 null 表示无需转交；为字符串表示需要将消息转交给其他 Agent 处理
3. 仅当当前任务超出你的能力范围、或需要其他角色协作时才设置 handoff
4. response 和 handoff 不能同时为空（至少有一项有内容）
5. 只返回 JSON，不要其他文字

## 推理步骤

生成前请依次分析：
1. 消息的核心诉求是什么？需要我作为「${agentRole}」提供什么？
2. 我的能力是否足以独立完成？是否有部分需要其他 Agent 协助？
3. 生成 response：基于我的角色和专长给出专业响应
4. 判断是否需要 handoff：若需要其他 Agent 协助，构造转交消息；否则设为 null
5. 汇总为 { response, handoff } JSON

## 输出格式

只返回单个合法 JSON 对象，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。`;
}