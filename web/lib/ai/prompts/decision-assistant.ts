// AI 决策辅助 prompt 模板——基于工作区上下文对决策问题进行多维度分析。
//
// AI 分析用户的决策问题，结合工作区上下文（任务、决策历史、项目进度）：
// - 列出可选方案（每个方案有标题、描述、优劣势、风险点）
// - 推荐方案 + 推荐理由（结合项目现状）
// - 参考历史决策（从工作区已有决策中检索相似的）
//
// 返回 JSON：
// {
//   "options": [{ "title", "description", "pros": string[], "cons": string[], "risks": string[] }],
//   "recommendation": { "optionIndex": number, "reason": string },
//   "historicalRefs": [{ "title": string, "outcome": string }]
// }

/** 近期任务摘要（标题 + 状态 + 优先级） */
interface DecisionContextTask {
  title: string;
  status: string;
  priority: string;
}

/** 近期决策历史摘要（关联任务标题 + markdown 摘要 + 日期） */
interface DecisionContextDecision {
  taskTitle: string;
  markdown: string;
  createdAt: string;
}

/** 项目进度统计 */
interface DecisionContextProgress {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
}

/** 决策辅助的工作区上下文（由 API 路由查询后注入 prompt） */
export interface DecisionContext {
  tasks: DecisionContextTask[];
  decisions: DecisionContextDecision[];
  progress: DecisionContextProgress;
}

/**
 * 构造决策辅助系统提示。
 *
 * 将工作区上下文（任务、决策历史、项目进度）注入 prompt，
 * 引导 AI 生成多维度方案分析 + 推荐 + 历史参考。
 *
 * @param context 工作区上下文（任务/决策/进度）
 * @returns system prompt 字符串
 */
export function buildDecisionAssistantSystemPrompt(
  context: DecisionContext,
): string {
  // 组装工作区上下文摘要
  const taskLines =
    context.tasks.length > 0
      ? context.tasks
          .map((t) => `- [${t.status}/${t.priority}] ${t.title}`)
          .join("\n")
      : "（暂无任务）";

  const decisionLines =
    context.decisions.length > 0
      ? context.decisions
          .map(
            (d) =>
              `- ${d.taskTitle}（${d.createdAt}）：${d.markdown.slice(0, 200)}`,
          )
          .join("\n")
      : "（暂无历史决策）";

  const progressLine = `总计 ${context.progress.totalTasks} 个任务，已完成 ${context.progress.completedTasks}，进行中 ${context.progress.inProgressTasks}，阻塞 ${context.progress.blockedTasks}`;

  return `你是决策辅助助手。基于工作区上下文对用户的决策问题进行多维度分析，给出方案建议与风险预判。

## 工作区上下文

### 项目进度
${progressLine}

### 近期任务
${taskLines}

### 历史决策
${decisionLines}

## 任务
分析用户的决策问题，结合上述工作区上下文：
1. 列出 2-4 个可选方案，每个方案包含标题、描述、优势（pros）、劣势（cons）、风险点（risks）
2. 从可选方案中推荐一个，并给出推荐理由（结合工作区上下文与项目现状）
3. 从历史决策中检索与当前问题相似的决策，作为参考（historicalRefs），每条包含标题和结果/结论

## 输出格式
返回 JSON：
{
  "options": [
    {
      "title": "方案标题",
      "description": "方案描述",
      "pros": ["优势1", "优势2"],
      "cons": ["劣势1", "劣势2"],
      "risks": ["风险点1", "风险点2"]
    }
  ],
  "recommendation": {
    "optionIndex": 0,
    "reason": "推荐理由"
  },
  "historicalRefs": [
    {
      "title": "历史决策标题",
      "outcome": "决策结果/结论"
    }
  ]
}

## 规则
1. options 数组包含 2-4 个方案，optionIndex 是推荐方案在 options 数组中的索引（从 0 开始）
2. 每个方案的 pros/cons/risks 为字符串数组，每条不超过 100 字符
3. recommendation.reason 不超过 300 字符，应结合工作区上下文说明为何推荐该方案
4. historicalRefs 从工作区历史决策中选取与当前问题相关的条目，若无相关历史则为空数组
5. 只返回 JSON，不要包含 markdown 代码块标记或其他文字
6. 方案应具体可执行，结合项目现状（任务进度、阻塞情况）给出务实建议

## 推理步骤
1. 用户决策问题的核心是什么？涉及哪些维度（技术/资源/时间/风险）？
2. 当前项目现状如何？有哪些约束条件（阻塞任务、资源限制、截止日期）？
3. 基于约束，有哪些可行方案？各自的优劣势和风险是什么？
4. 结合历史决策，哪个方案更契合团队过往的选择倾向？
5. 综合评估，推荐哪个方案？理由是什么？`;
}

/**
 * 构造决策辅助用户提示。
 *
 * @param question 用户的决策问题（已 trim，1-2000 字符）
 * @param extraContext 可选的补充背景信息
 * @returns user prompt 字符串
 */
export function buildDecisionAssistantUserPrompt(
  question: string,
  extraContext?: string,
): string {
  const base = `决策问题：${question}`;
  if (extraContext && extraContext.trim()) {
    return `${base}\n\n补充背景：${extraContext}`;
  }
  return base;
}