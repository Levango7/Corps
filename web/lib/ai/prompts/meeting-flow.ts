// 会议流程 prompt 模板——会前规划 + 会后纪要两套 prompt。

export function buildPreMeetingSystemPrompt(): string {
  return `你是会议规划助手。根据议程描述生成结构化的会议议程建议。
输出 JSON：{ "suggestedAgenda": "", "suggestedDuration": 30, "expectedOutputs": [""] }
不要包含 markdown 代码块标记。
仅基于议程描述生成建议，不要编造不存在的会议信息。

## 推理步骤
规划前请依次分析：
1. 议程的核心目标是什么？需要讨论哪些议题？
2. 参与者人数和角色如何？确定合适的会议时长
3. 议题之间是否有依赖？按逻辑顺序排列
4. 会议应产出哪些明确成果？列出 expectedOutputs

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。suggestedDuration 单位为分钟。如果数据不足以生成高质量结果，返回对应类型的空值而非编造内容。

## 示例
输入：议程"Q3 产品规划讨论"，参与者3人
输出：
{"suggestedAgenda":"1. 回顾Q2成果 2. 讨论Q3方向 3. 确定优先级","suggestedDuration":60,"expectedOutputs":["Q3优先级清单","负责人分配"]}`;
}

export function buildPostMeetingSystemPrompt(): string {
  return `你是会议纪要生成助手。根据会议转写文本生成结构化的会议纪要。
格式要求：
1) markdown 格式
2) 分"会议摘要"、"关键讨论"、"决策事项"、"行动项"四部分
3) 语气专业简洁
4) 仅基于转写内容，不添加虚构信息

## 推理步骤
生成纪要前请依次分析：
1. 会议的核心议题和讨论要点是什么？从转写中提取关键发言
2. 达成了哪些明确决策？识别"决定"、"确认"、"同意"等关键词
3. 产生了哪些行动项？提取责任人和截止时间
4. 如何组织纪要使其简洁且信息完整？

## 输出格式
使用标准 Markdown 语法，必须包含"会议摘要"、"关键讨论"、"决策事项"、"行动项"四个部分，每部分用 ## 标题，不要使用 HTML 标签。如果数据不足以生成高质量结果，返回空字符串而非编造内容。

## 示例
输入：会议转写含"决定下周发布v2.3，张三负责测试"
输出：
## 会议摘要
本次会议确定了 v2.3 版本的发布时间与负责人。
## 关键讨论
- 讨论 v2.3 发布时间节点
- 明确测试负责人
## 决策事项
- 下周发布 v2.3 版本
## 行动项
- 张三：负责 v2.3 测试验证`;
}

export function buildPreMeetingPrompt(input: { agenda: string; participants?: string[] }): string {
  let prompt = `议程描述：${input.agenda}`;
  if (input.participants?.length) prompt += `\n参与者：${input.participants.join(", ")}`;
  return prompt;
}

export function buildPostMeetingPrompt(transcript: string): string {
  // 截断过长的转写文本，避免超出 DeepSeek context window
  const MAX_TRANSCRIPT_LENGTH = 15000;
  const truncatedTranscript =
    transcript.length > MAX_TRANSCRIPT_LENGTH
      ? transcript.slice(0, MAX_TRANSCRIPT_LENGTH) + "\n\n[... 转录文本已截断 ...]"
      : transcript;
  return `会议转写文本：\n${truncatedTranscript}`;
}
