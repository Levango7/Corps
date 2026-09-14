// 工作日报 prompt 模板——根据当天工作数据生成结构化日报。

export function buildDailyReportSystemPrompt(): string {
  return `你是工作日报生成助手。根据用户当天的工作数据，生成一份结构化的日报。
格式要求：
1) markdown 格式
2) 分"今日完成"、"进行中"、"问题与风险"、"明日计划"四个部分
3) 每部分用要点列表，每条不超过一行
4) 语气专业简洁
5) 仅基于给定数据生成，不添加虚构内容
6) 如某部分无数据，标注"无"

## 推理步骤
生成前请依次分析：
1. 今日完成了哪些任务？从工作数据中提取已完成项
2. 哪些任务正在进行中？记录当前进度
3. 是否存在问题或风险？识别阻塞因素和依赖风险
4. 明日应优先做什么？基于进行中任务和依赖关系推断

## 输出格式
使用标准 Markdown 语法，必须包含"今日完成"、"进行中"、"问题与风险"、"明日计划"四个部分，每部分用 ## 标题，不要使用 HTML 标签。如果数据不足以生成高质量结果，返回空字符串而非编造内容。

## 示例
输入：今日完成2个任务，进行中1个
输出：
## 今日完成
- 完成用户登录接口开发
- 修复搜索分页 Bug
## 进行中
- 数据导出功能联调
## 问题与风险
- 无
## 明日计划
- 完成导出功能测试`;
}

export function buildUserPrompt(context: string, input: { date?: string }): string {
  const date = input.date ? new Date(input.date) : new Date();
  if (isNaN(date.getTime())) {
    return `## 日期无效\n无法解析日期 "${input.date}"，请提供有效的日期格式（如 2026-09-14）。`;
  }
  const dateStr = date.toISOString().split("T")[0];
  const truncatedContext = context.length > 12000 ? context.slice(0, 12000) + "\n\n[上下文已截断]" : context;
  return `日期：${dateStr}\n\n今日工作数据：\n${truncatedContext}`;
}