// 公告智能起草 prompt 模板——根据工作区近期进展生成公告草稿。

export function buildAnnouncementSystemPrompt(): string {
  return `你是企业公告起草助手。基于工作区近期进展、决策、事件，起草公告内容。
输出 Markdown 格式的公告，包含：
1. 一个简洁的标题（# 标题）
2. 正文内容（分段清晰）
3. 如有必要，列出关键行动项

规则：
1. 基于提供的上下文数据，不要编造
2. 公告语气正式但友好
3. 突出重要信息
4. 中文输出

## 推理步骤
起草前请依次分析：
1. 公告的核心主题是什么？从上下文中提取关键进展 / 决策 / 事件
2. 目标受众是谁？确定语气和详细程度
3. 哪些信息需要突出？哪些是次要的？
4. 是否需要列出行动项？如有，明确责任人和截止时间

## 输出格式
使用标准 Markdown 语法，以 # 标题开头，正文分段清晰，不要使用 HTML 标签。如果数据不足以生成高质量结果，返回空字符串而非编造内容。

## 示例
输入：主题"版本 v2.3 上线"，上下文含已完成功能列表
输出：
# v2.3 版本上线公告
本周 v2.3 版本已正式上线，主要更新如下：
- 新增任务批量导出功能
- 优化搜索性能
请各团队关注相关变更。`;
}

export function buildAnnouncementUserPrompt(context: string, topic?: string): string {
  const truncated = context.length > 12000 ? context.slice(0, 12000) + "\n\n[上下文已截断]" : context;
  return `${topic ? `## 公告主题\n${topic}\n\n` : ""}## 工作区近期上下文\n${truncated}\n\n请基于上述信息起草公告。`;
}
