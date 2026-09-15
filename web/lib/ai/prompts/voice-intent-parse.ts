// AI 语音意图解析 prompt 模板（方向 H）——从语音转录文本中识别用户意图并提取参数。
//
// 设计要点：
// - 输入：transcript（语音转录文本）+ workspaceContext（工作区上下文摘要）
// - 输出：严格 JSON 格式 { intent, parameters, confidence, response }
// - 七种意图类型：create_task / query_schedule / send_message / generate_report
//   / search_knowledge / open_page / unknown
// - 含 few-shot 示例引导模型输出格式
// - 中文输出
//
// 来源：方向 H 任务 1（voice-intent-parse prompt 模板）

/** 意图类型枚举 */
export type VoiceIntent =
  | "create_task"
  | "query_schedule"
  | "send_message"
  | "generate_report"
  | "search_knowledge"
  | "open_page"
  | "unknown";

/** AI 输出契约 */
export interface VoiceIntentResult {
  /** 意图类型 */
  intent: VoiceIntent;
  /** 提取的参数（如任务标题、日程时间、消息接收人等） */
  parameters: Record<string, unknown>;
  /** 置信度 0.0-1.0 */
  confidence: number;
  /** 给用户的自然语言响应 */
  response: string;
}

/**
 * 语音意图解析系统 prompt：定义 AI 角色、任务与输出格式。
 */
export function buildVoiceIntentSystemPrompt(): string {
  return `你是企业工作区的语音命令解析助手。
从用户的语音转录文本中识别意图并提取参数，帮助用户通过语音高效操作工作区。

支持的意图类型：
1. create_task — 创建任务。参数：title（标题）、assignee（指派人）、dueDate（截止日期）、priority（优先级）
2. query_schedule — 查询日程。参数：date（日期）、range（范围：today/week/month）
3. send_message — 发送消息。参数：recipient（接收人）、content（消息内容）
4. generate_report — 生成报告。参数：type（报告类型）、period（时间范围）
5. search_knowledge — 搜索知识。参数：query（搜索关键词）
6. open_page — 打开页面。参数：page（页面标识，如 tasks/documents/analytics/settings）
7. unknown — 无法识别的意图

解析规则：
1. 严格基于转录文本解析，不要编造文本中未提及的信息
2. parameters 只包含能从文本中明确提取的字段，不要填充默认值
3. confidence 表示解析置信度，范围 0.0-1.0
4. response 是给用户的自然语言确认回复，简洁友好
5. 中文输出
6. 输出严格的 JSON 格式，不要包含任何其他文本

## 推理步骤
1. 分析转录文本的关键动词和名词，识别意图类型
2. 根据意图类型提取对应参数（时间、人名、标题等）
3. 综合上下文判断置信度
4. 生成简洁的确认回复

## 输出格式
输出一个 JSON 对象：
{
  "intent": "create_task" | "query_schedule" | "send_message" | "generate_report" | "search_knowledge" | "open_page" | "unknown",
  "parameters": {},
  "confidence": 0.0-1.0,
  "response": "给用户的确认回复"
}

## 示例

### 示例 1
转录文本："帮我创建一个任务，标题是整理周报，指派给张三，下周五截止"
输出：
{
  "intent": "create_task",
  "parameters": {
    "title": "整理周报",
    "assignee": "张三",
    "dueDate": "下周五"
  },
  "confidence": 0.95,
  "response": "好的，我将为您创建任务「整理周报」，指派给张三，截止日期为下周五，请确认。"
}

### 示例 2
转录文本："今天有什么日程安排"
输出：
{
  "intent": "query_schedule",
  "parameters": {
    "date": "today",
    "range": "today"
  },
  "confidence": 0.9,
  "response": "好的，我来查询您今天的日程安排。"
}

### 示例 3
转录文本："打开任务页面"
输出：
{
  "intent": "open_page",
  "parameters": {
    "page": "tasks"
  },
  "confidence": 0.95,
  "response": "好的，正在为您打开任务页面。"
}

### 示例 4
转录文本："嗯嗯啊啊"
输出：
{
  "intent": "unknown",
  "parameters": {},
  "confidence": 0.1,
  "response": "抱歉，我没有听清，请再说一遍。"
}`;
}

/**
 * 构造语音意图解析的 user prompt。
 *
 * @param transcript 语音转录文本
 * @param workspaceContext 工作区上下文摘要（如当前页面、最近任务等，可为空字符串）
 */
export function buildVoiceIntentPrompt(
  transcript: string,
  workspaceContext: string,
): string {
  const ctxSection =
    workspaceContext.trim().length > 0
      ? `## 工作区上下文\n${workspaceContext}\n`
      : "";

  return `${ctxSection}## 用户语音转录文本
${transcript}

请解析上述语音转录文本的意图并提取参数，输出 JSON 格式。`;
}