// AI 日历智能排程 prompt 模板。
// 系统提示约束 LLM 输出 JSON 排程建议；用户提示注入自然语言需求 + 工作区日历上下文。

/** 排程需求输入 */
export interface CalendarScheduleInput {
  /** 自然语言排程描述（如"下周二下午开产品评审会"） */
  description: string;
  /** 期望时长（分钟），可选 */
  duration?: number;
  /** 参与人员列表，可选 */
  attendees?: string[];
}

/**
 * 系统提示：约束 LLM 返回结构化 JSON 排程建议。
 * 不在工作区内的事件上下文由用户提示注入，系统提示仅声明输出契约与排程规则。
 */
export function buildCalendarSystemPrompt(): string {
  return `你是日历智能排程助手。根据用户的自然语言描述和工作区日历上下文，生成合理的会议/事件排程建议。
要求：
1) 返回 JSON，格式：{"suggestions":[{"title":"string","startTime":"ISO 8601","endTime":"ISO 8601","duration":number,"reason":"string","conflicts":"string|null"}]}
2) suggestions 数组包含 1-3 个排程方案
3) 避开已有事件的时间冲突
4) duration 单位为分钟
5) reason 说明为何推荐此时段
6) conflicts 若有冲突说明，无冲突为 null
7) 仅基于给定数据，不虚构信息

## 推理步骤
排程前请依次分析：
1. 用户期望的时间范围是什么？（解析"下周二下午"等自然语言时间）
2. 工作区日历中该时段是否已有事件？检测冲突
3. 参与人员是否有空闲时段？优先选择全员可用时段
4. 生成 1-3 个备选方案，说明推荐理由

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。startTime / endTime 必须是 ISO 8601 格式，duration 单位为分钟。时区：使用用户所在时区（由调用方在 user prompt 中提供），输出时间的 ISO 8601 格式须带时区偏移量。如果数据不足以生成高质量结果，返回对应类型的空值而非编造内容。

## 示例
输入：下周二下午开产品评审会，2 小时
输出：
{"suggestions":[{"title":"产品评审会","startTime":"2026-09-15T14:00:00+08:00","endTime":"2026-09-15T16:00:00+08:00","duration":120,"reason":"下周二下午无已有事件，适合安排评审会","conflicts":null}]}`;
}

/**
 * 用户提示：拼接排程需求 + 工作区日历上下文。
 * 空字段（如未提供 duration / attendees）自动滤除，保持提示紧凑。
 */
export function buildCalendarUserPrompt(
  context: string,
  input: CalendarScheduleInput,
): string {
  const truncated = context.length > 12000 ? context.slice(0, 12000) + "\n\n[上下文已截断]" : context;
  const lines = [
    `排程需求：${input.description}`,
    input.duration ? `期望时长：${input.duration} 分钟` : "",
    input.attendees?.length ? `参与人员：${input.attendees.join("、")}` : "",
    "",
    "工作区日历上下文：",
    truncated,
  ];
  return lines.filter(Boolean).join("\n");
}