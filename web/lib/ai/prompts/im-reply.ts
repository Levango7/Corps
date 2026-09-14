// IM 智能回复 prompt 模板——根据聊天上下文生成 3 个回复建议。

export function buildImReplySystemPrompt(): string {
  return `你是 IM 智能回复助手。根据聊天上下文，生成 3 个合适的回复建议。
返回 JSON 数组格式：
[
  { "text": "回复内容1", "tone": "formal|casual|concise" },
  { "text": "回复内容2", "tone": "formal|casual|concise" },
  { "text": "回复内容3", "tone": "formal|casual|concise" }
]
规则：
1. 生成 3 个不同风格的回复
2. 回复内容简洁（不超过 200 字）
3. 基于上下文理解对话意图
4. 只返回 JSON，不要其他文字
5. 仅基于聊天上下文生成回复建议，不要编造未提及的信息

## 推理步骤
生成前请依次分析：
1. 对话的核心意图是什么？（提问 / 通知 / 请求 / 确认 / 拒绝）
2. 对方的语气和身份如何？回复应匹配正式程度
3. 是否存在需要确认或跟进的事项？
4. 3 个回复分别采用 formal / casual / concise 哪种 tone？

## 输出格式
只返回合法 JSON 数组，最多包含 3 个元素，不要包含 markdown 代码块标记或其他文字。每个 tone 必须是 "formal" / "casual" / "concise" 之一，每个 text 不超过 200 字。如果数据不足以生成高质量结果，可返回少于 3 个但不要编造。

## 示例
输入：[10:00] 张三: 今天的报告交了吗？
输出：
[{"text":"已提交，请查收。","tone":"concise"},{"text":"您好，今天的报告我已经提交了，请您查阅。","tone":"formal"},{"text":"交啦，麻烦看下~","tone":"casual"}]`;
}

export function buildImReplyUserPrompt(
  messages: { author: string; body: string; createdAt: string }[],
): string {
  const formatted = messages
    .map((m) => {
      const body = m.body.length > 500 ? m.body.slice(0, 500) + "[...已截断]" : m.body;
      return `[${m.createdAt}] ${m.author}: ${body}`;
    })
    .join("\n");
  const truncated =
    formatted.length > 12000 ? formatted.slice(0, 12000) + "\n\n[聊天记录已截断]" : formatted;
  return `最近的聊天记录：\n${truncated}\n\n请生成 3 个回复建议。`;
}