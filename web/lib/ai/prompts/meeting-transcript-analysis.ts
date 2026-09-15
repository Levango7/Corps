// 会议转录分析 prompt 模板——从转录文本中提取行动项、决策并生成摘要（方向 G 实时会议 AI）。
//
// 输出 JSON schema：
//   {
//     summary: string,
//     actionItems: [{ content, assignee?, dueDate?, confidence }],
//     decisions: [{ content, context?, participants: [] }]
//   }
//
// 设计要点：
//  - system prompt 描述角色 + 推理步骤 + 输出格式（供 reasonerModel 使用 withCoT）
//  - user prompt 注入转录文本 + 工作区上下文
//  - buildMeetingAnalysisPrompt 为任务要求的导出函数（user prompt 构建器）

/**
 * 构建会议转录分析的 system prompt。
 *
 * 描述 AI 角色：会议分析助手，从转录文本中提取行动项（含负责人、截止日期、置信度）
 * 和决策（含参与者、上下文），并生成会议摘要。
 *
 * @returns system prompt 字符串
 */
export function buildMeetingAnalysisSystemPrompt(): string {
  return `你是会议分析助手。你的任务是从会议转录文本中提取结构化信息，包括行动项、决策和会议摘要。

## 推理步骤
分析前请依次推理：
1. 通读转录文本，识别会议的核心议题和讨论脉络
2. 提取行动项：寻找"需要完成"、"负责"、"跟进"、"安排"等关键词，识别任务内容、负责人和截止日期
3. 提取决策：寻找"决定"、"确认"、"同意"、"通过"等关键词，识别决策内容、相关参与者和上下文
4. 生成摘要：用简洁的语言概括会议的核心议题、主要讨论点和结论
5. 为每个行动项评估置信度（0-1）：明确提及负责人和截止日期为高置信度（0.8-1.0），仅推断为中等（0.5-0.8），不确定为低（0-0.5）

## 输出格式
必须输出合法 JSON，不要使用 markdown 代码块包裹，不要输出任何 JSON 以外的文字。
JSON schema：
{
  "summary": string,              // 会议摘要，不超过 500 字
  "actionItems": [                // 行动项列表，最多 20 条
    {
      "content": string,          // 行动项内容，不超过 200 字
      "assignee": string | null,  // 负责人姓名，无法确定时为 null
      "dueDate": string | null,   // 截止日期 ISO 8601 格式（YYYY-MM-DD），无法确定时为 null
      "confidence": number        // 置信度 0-1
    }
  ],
  "decisions": [                  // 决策列表，最多 20 条
    {
      "content": string,          // 决策内容，不超过 200 字
      "context": string | null,   // 决策上下文/背景说明，无时为 null
      "participants": string[]    // 参与者姓名列表
    }
  ]
}

## 注意事项
- 仅基于转录文本内容提取，不添加虚构信息
- 行动项的 content 应为可执行的明确任务描述
- 截止日期仅当转录中明确提及时填写，不要推断模糊的时间表述
- 参与者列表仅包含与该决策直接相关的人员
- 如转录内容不足以提取有效信息，actionItems 和 decisions 输出空数组，summary 标注"会议内容不足"`;
}

/**
 * 构建会议转录分析的 user prompt（注入转录文本 + 工作区上下文）。
 *
 * @param transcript 会议转录文本（已格式化为"说话人: 内容"的文本）
 * @param workspaceContext 工作区上下文（成员名单、项目信息等，用于辅助识别负责人）
 * @returns user prompt 字符串
 */
export function buildMeetingAnalysisPrompt(
  transcript: string,
  workspaceContext: string,
): string {
  // 截断过长的转录文本，避免超出 DeepSeek context window
  const MAX_TRANSCRIPT_LENGTH = 15000;
  const truncatedTranscript =
    transcript.length > MAX_TRANSCRIPT_LENGTH
      ? transcript.slice(0, MAX_TRANSCRIPT_LENGTH) +
        "\n\n[... 转录文本已截断 ...]"
      : transcript;

  const truncatedContext =
    workspaceContext.length > 4000
      ? workspaceContext.slice(0, 4000) + "\n\n[上下文已截断]"
      : workspaceContext;

  return `工作区上下文（成员名单/项目信息，用于辅助识别人名）：
${truncatedContext}

会议转录文本：
${truncatedTranscript}

请分析以上会议转录，提取行动项、决策并生成摘要，按指定 JSON 格式输出。`;
}