// 会议纪要生成 prompt 模板——从会议转写文本生成完整结构化纪要（W2-A 会议纪要增强）。
//
// 输出 JSON schema：
//   {
//     title: string,
//     keyPoints: string[],
//     decisions: [{ title, description }],
//     actionItems: [{ title, assignee?, dueDate?, priority }],
//     participants: string[]
//   }
//
// 设计要点：
//  - system prompt 描述角色 + 推理步骤 + 输出格式（供 reasonerModel 使用 withCoT）
//  - user prompt 注入转写文本 + 可选会议标题
//  - 与 meeting-transcript-analysis.ts 的区别：本 prompt 生成"完整纪要"，
//    包含会议主题、关键讨论点、参与者等纪要要素，而非仅提取行动项/决策/摘要

/**
 * 构建会议纪要生成的 system prompt。
 *
 * 描述 AI 角色：会议纪要助手，根据会议转写文本生成完整结构化纪要，
 * 包含会议主题、关键讨论点、决策项、待办事项和参与者列表。
 *
 * @returns system prompt 字符串
 */
export function buildMeetingSummarySystemPrompt(): string {
  return `你是会议纪要助手。你的任务是根据会议转写文本生成完整、结构化的会议纪要。

## 推理步骤
生成纪要前请依次推理：
1. 通读转写文本，识别会议的主题和整体脉络
2. 提取关键讨论点：概括会议中讨论的主要议题和观点（每点一句话，简洁明了）
3. 提取决策项：寻找"决定"、"确认"、"同意"、"通过"等关键词，识别决策标题和详细说明
4. 提取待办事项：寻找"需要完成"、"负责"、"跟进"、"安排"等关键词，识别任务标题、负责人、截止日期和优先级
5. 识别参与者：从转写文本中提取所有发言人的姓名
6. 生成会议标题：如已提供会议标题则沿用，否则根据内容概括一个简洁标题

## 输出格式
必须输出合法 JSON，不要使用 markdown 代码块包裹，不要输出任何 JSON 以外的文字。
JSON schema：
{
  "title": string,                  // 会议标题，不超过 100 字
  "keyPoints": [                    // 关键讨论点列表，最多 15 条
    string                          // 每条不超过 200 字
  ],
  "decisions": [                    // 决策项列表，最多 20 条
    {
      "title": string,              // 决策标题，不超过 200 字
      "description": string         // 决策详细说明，不超过 500 字
    }
  ],
  "actionItems": [                  // 待办事项列表，最多 20 条
    {
      "title": string,              // 待办标题，不超过 200 字
      "assignee": string | null,    // 负责人姓名，无法确定时为 null
      "dueDate": string | null,     // 截止日期 ISO 8601 格式（YYYY-MM-DD），无法确定时为 null
      "priority": "low" | "medium" | "high" | "urgent"  // 优先级
    }
  ],
  "participants": [                 // 参与者姓名列表
    string
  ]
}

## 注意事项
- 仅基于转写文本内容提取，不添加虚构信息
- 关键讨论点应涵盖会议的核心议题，按讨论顺序排列
- 决策项的 title 应简明扼要，description 应包含决策的背景和结论
- 待办事项的 title 应为可执行的明确任务描述
- 截止日期仅当转写中明确提及时填写，不要推断模糊的时间表述
- 优先级根据任务紧急程度判断：明确提及"紧急/立即"为 urgent，"重要/优先"为 high，普通为 medium，低优先级为 low
- 参与者列表应去重，仅包含实际发言或被提及参与的人员
- 如转写内容不足以提取有效信息，对应数组输出空数组，title 标注"会议内容不足"`;
}

/**
 * 构建会议纪要生成的 user prompt（注入转写文本 + 可选会议标题）。
 *
 * @param transcript 会议转写文本（已格式化为"说话人: 内容"的文本，或原始转写文本）
 * @param meetingTitle 可选的会议标题（如已知道会议名称，传入可提升生成质量）
 * @returns user prompt 字符串
 */
export function buildMeetingSummaryUserPrompt(transcript: string, meetingTitle?: string): string {
  // 截断过长的转写文本，避免超出 DeepSeek context window
  const MAX_TRANSCRIPT_LENGTH = 30000;
  const truncatedTranscript =
    transcript.length > MAX_TRANSCRIPT_LENGTH
      ? transcript.slice(0, MAX_TRANSCRIPT_LENGTH) + "\n\n[... 转录文本已截断 ...]"
      : transcript;

  const titleLine = meetingTitle?.trim() ? `会议标题：${meetingTitle.trim()}\n\n` : "";

  return `${titleLine}会议转写文本：
${truncatedTranscript}

请根据以上会议转写生成完整的结构化会议纪要，按指定 JSON 格式输出。`;
}
