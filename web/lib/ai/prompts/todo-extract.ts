// AI 待办提取 prompt 模板——从消息 / 文档 / 邮件内容中识别隐含的待办事项。
//
// 设计要点：
//  - 系统提示引导模型识别"需要..."、"请..."、"明天前..."等隐含行动项
//  - 智能推断优先级（urgent/high/medium/low）、截止日期（从时间表达）、负责人（从人名）
//  - 输出 JSON：{ todos: [{ title, description?, assignee?, dueDate?, priority, confidence }], reasoning }
//  - 用户提示注入源类型、原文内容与可选候选人列表，辅助负责人匹配

/** 源类型：消息 / 文档 / 邮件 */
export type TodoExtractSource = "message" | "document" | "email";

/** 用户提示的可选上下文 */
export interface TodoExtractContext {
  /** 候选负责人姓名列表，帮助 AI 在文本中匹配具体人名 */
  assignees?: string[];
}

/**
 * 构建待办提取系统提示。
 *
 * 指示 AI：
 *  1. 识别隐含任务 / 行动项（"需要..."、"请..."、"明天前..."等）
 *  2. 智能推断优先级（urgent/high/medium/low）
 *  3. 智能推断截止日期（从文本中的时间表达，输出 ISO 8601 字符串）
 *  4. 智能匹配负责人（从文本中的人名，结合候选列表）
 *  5. 为每条待办给出 confidence（0-1），表达提取置信度
 */
export function buildTodoExtractSystemPrompt(): string {
  return `你是项目协作助手。从用户提供的文本内容中提取隐含的待办事项（行动项）。

要求：
1) 识别所有隐含的任务 / 行动项，常见触发词包括但不限于："需要..."、"请..."、"务必..."、"明天前..."、"本周内..."、"由 XX 负责..."、"XX 跟进..."
2) 不要把陈述句、信息通报、提问句当作待办；只提取确实需要某人执行的动作
3) 智能推断优先级：
   - urgent：含"立即"、"马上"、"今天前"、"ASAP"等紧急表达
   - high：含"尽快"、"本周内"、明确近期 deadline
   - medium：普通行动项
   - low：弱行动项或时间宽裕
4) 智能推断截止日期：从文本中的时间表达（"明天"、"下周五"、"3 月底"等）推断，输出 ISO 8601 字符串（YYYY-MM-DD 或完整 datetime）；无法确定时返回 null
5) 智能匹配负责人：从文本中的人名推断；若提供候选人列表，优先匹配列表中的姓名；无法确定时返回 null
6) 为每条待办给出 confidence（0-1 的数字），表达提取置信度
7) 不添加虚构内容，仅基于给定文本提取
8) title 简洁可执行（≤120 字符），description 补充上下文（可空）

输出 JSON：
{ "todos": [{ "title": "", "description": "", "assignee": null, "dueDate": null, "priority": "low|medium|high|urgent", "confidence": 0.0 }], "reasoning": "" }

不要包含 markdown 代码块标记。

## 推理步骤
提取前请依次分析：
1. 文本中哪些句子表达了一个需要执行的动作？（区分行动项与陈述）
2. 每个行动项的执行者是谁？文本中是否提到人名？是否匹配候选人列表？
3. 行动项的时间约束如何？是否有明确截止日期？优先级如何？
4. 每条提取的置信度如何？（明确表达高，推断表达低）

## 输出格式
只返回合法 JSON，可被 JSON.parse() 直接解析，不要包含 markdown 代码块标记或其他文字。priority 必须是 "low" / "medium" / "high" / "urgent" 之一，confidence 必须是 0-1 的数字，dueDate 为 ISO 8601 字符串或 null，assignee 为字符串或 null。如果文本中没有可提取的待办，返回 { "todos": [], "reasoning": "未识别到隐含待办事项" }。

## 示例
输入（source=message）：
"明天前把设计稿给到前端，@张三 负责跟进。另外请李四准备下周一的评审材料。"
输出：
{"todos":[{"title":"把设计稿交付给前端","description":"明天前完成","assignee":"张三","dueDate":"2026-09-17","priority":"high","confidence":0.9},{"title":"准备下周一的评审材料","description":"下周一评审用","assignee":"李四","dueDate":"2026-09-22","priority":"medium","confidence":0.85}],"reasoning":"识别到两个明确行动项：张三明天前交付设计稿（高优先级，明确 deadline），李四准备下周一评审材料（中优先级，推断 deadline 为下周一）"}`;
}

/**
 * 构建待办提取用户提示。
 *
 * @param source 源类型（message / document / email）
 * @param content 原文内容
 * @param context 可选上下文，含候选人列表
 */
export function buildTodoExtractUserPrompt(
  source: TodoExtractSource,
  content: string,
  context?: TodoExtractContext,
): string {
  const sourceLabel = source === "message" ? "消息" : source === "document" ? "文档" : "邮件";
  let prompt = `源类型：${sourceLabel}\n\n内容：\n${content}`;
  if (context?.assignees && context.assignees.length > 0) {
    prompt += `\n\n候选人列表（用于匹配负责人）：${context.assignees.join("、")}`;
  }
  return prompt;
}
