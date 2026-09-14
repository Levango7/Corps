// AI 跨能力联动编排引擎——聚合全量上下文 → LLM 建议联动方案 → 用户确认后执行。
//
// 设计要点：
// - suggestOrchestration：在 runWithWorkspace 事务内聚合全量上下文（所有 scope），
//   传给 reasonerModel 生成联动方案 JSON，经 cleanJsonResponse + normalizePlan 校验规范化
// - executeOrchestration：委托 executeAiActions 在 RLS 事务内原子执行（任一失败全部回滚）
// - normalizePlan：校验 summary/reasoning 长度 + actions 数量（≤5）+ 每个 action 的 type 和必填字段
// - 安全约束：suggestOrchestration 仅"建议"不执行；执行须经用户确认后调用 executeOrchestration

import { generateText } from "ai";
import { reasonerModel, withCoT } from "@/lib/ai/deepseek";
import {
  buildAiContext,
  type AiContextScope,
} from "@/lib/ai/context";
import {
  executeAiActions,
  type AiAction,
  type AiActionResult,
} from "@/lib/ai/executor";
import { runWithWorkspace } from "@/lib/auth";
import {
  buildOrchestrationSystemPrompt,
  buildOrchestrationUserPrompt,
} from "@/lib/ai/prompts/orchestration";

/**
 * 联动编排方案——LLM 生成的建议结果。
 *
 * @property summary 方案摘要（≤100 字符）
 * @property reasoning 推理过程（≤500 字符）
 * @property actions 建议的操作序列（≤5 个），空数组表示无需联动
 */
export interface OrchestrationPlan {
  summary: string;
  reasoning: string;
  actions: AiAction[];
}

/**
 * 全量上下文 scope——聚合工作区所有维度的数据供 LLM 分析。
 *
 * 共 20 种 scope（AiContextScope 类型定义的全部值）：
 * 13 个基础 scope + 7 个细粒度 v2 扩展 scope。
 */
export const ORCHESTRATION_SCOPES: AiContextScope[] = [
  // ─── 基础 scope ───
  "tasks:completed:today",
  "tasks:blocked",
  "tasks:overdue",
  "documents:edited:today",
  "meetings:today",
  "approvals:handled:today",
  "approvals:pending",
  "okr:progress",
  "time:today",
  "time:week",
  "wiki:edited:today",
  "decisions:recent",
  "im:recent",
  // ─── 细粒度 scope（v2 扩展）───
  "tasks:created:today",
  "tasks:high:priority",
  "meetings:upcoming",
  "okr:at:risk",
  "approvals:overdue",
  "im:unread",
  "members:active",
];

/** AiAction 的 8 种有效 type 枚举 */
const VALID_ACTION_TYPES = new Set([
  "createTask",
  "linkToOkr",
  "notify",
  "createDocument",
  "scheduleMeeting",
  "updateTaskStatus",
  "createDecision",
  "sendAnnouncement",
]);

/** createTask.priority 有效枚举（与 executor.ts executeAction 保持一致） */
const VALID_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
/** updateTaskStatus.status 有效枚举（与 executor.ts executeAction 保持一致） */
const VALID_TASK_STATUSES = new Set([
  "todo",
  "in_progress",
  "review",
  "done",
]);
/** sendAnnouncement.announcementType 有效枚举（与 executor.ts executeAction 保持一致） */
const VALID_ANNOUNCEMENT_TYPES = new Set(["info", "warning", "urgent"]);

/** summary 最大长度 */
const MAX_SUMMARY_LEN = 100;
/** reasoning 最大长度 */
const MAX_REASONING_LEN = 500;
/** actions 最大数量 */
const MAX_ACTIONS = 5;

/**
 * 按 Unicode 码点安全截断字符串（避免截断代理对，如 emoji）。
 *
 * String.prototype.slice 按 UTF-16 code unit 截断，遇到 emoji（由两个 code unit 组成的
 * 代理对）时可能从中间截断产生乱码。Array.from 按 Unicode 码点拆分，避免此问题。
 */
function safeSlice(s: string, max: number): string {
  return Array.from(s).slice(0, max).join("");
}

/**
 * 清理 LLM 返回的 JSON 文本：去掉 ```json ... ``` 代码块包裹。
 *
 * @param text LLM 原始输出
 * @returns 去除代码块标记后的 JSON 字符串
 */
export function cleanJsonResponse(text: string): string {
  let t = text.trim();
  const fenceMatch = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch && fenceMatch[1]) {
    t = fenceMatch[1].trim();
  }
  return t;
}

/**
 * 校验单个 action 的必填字段 + 枚举值。
 *
 * 枚举校验与 executor.ts executeAction 中的白名单保持一致，
 * 确保通过校验的 action 能被成功执行（不会校验通过但执行失败）。
 *
 * @returns true 表示必填字段齐全且枚举值合法，false 表示缺失或非法
 */
export function validateActionFields(a: Record<string, unknown>): boolean {
  switch (a.type) {
    case "createTask":
      return (
        typeof a.title === "string" && a.title.trim() !== "" &&
        typeof a.description === "string" &&
        typeof a.priority === "string" && VALID_PRIORITIES.has(a.priority) &&
        // 可选字段类型校验：assigneeId/dueDate 传入时须为 string
        (a.assigneeId === undefined || typeof a.assigneeId === "string") &&
        (a.dueDate === undefined || typeof a.dueDate === "string")
      );
    case "linkToOkr":
      return typeof a.taskId === "string" && typeof a.keyResultId === "string";
    case "notify":
      return typeof a.userId === "string" && typeof a.message === "string";
    case "createDocument":
      return (
        typeof a.title === "string" && typeof a.markdown === "string" &&
        // 可选字段：authorId 传入时须为 string
        (a.authorId === undefined || typeof a.authorId === "string")
      );
    case "scheduleMeeting":
      return (
        typeof a.title === "string" && typeof a.scheduledAt === "string" &&
        // 可选字段：description 传入时须为 string；participantIds 传入时须为 string 数组
        (a.description === undefined || typeof a.description === "string") &&
        (a.participantIds === undefined ||
          (Array.isArray(a.participantIds) &&
            a.participantIds.every((p) => typeof p === "string")))
      );
    case "updateTaskStatus":
      return (
        typeof a.taskId === "string" &&
        typeof a.status === "string" && VALID_TASK_STATUSES.has(a.status)
      );
    case "createDecision":
      return typeof a.taskId === "string" && typeof a.markdown === "string";
    case "sendAnnouncement":
      return (
        typeof a.title === "string" && typeof a.content === "string" &&
        // announcementType 可选，传入时必须是合法枚举
        (a.announcementType === undefined ||
          (typeof a.announcementType === "string" &&
            VALID_ANNOUNCEMENT_TYPES.has(a.announcementType))) &&
        // targetAudience 可选，传入时须为可序列化对象（非 null 基本类型/数组/对象）
        (a.targetAudience === undefined ||
          (a.targetAudience !== null && typeof a.targetAudience === "object"))
      );
    default:
      return false;
  }
}

/**
 * 校验并规范化 LLM 返回的联动方案。
 *
 * 校验规则：
 * - summary：必填字符串，截断至 100 字符
 * - reasoning：必填字符串，截断至 500 字符
 * - actions：数组，最多 5 个，每个 action 的 type 必须在 8 种枚举内且必填字段齐全
 *
 * @param raw JSON.parse 后的原始对象
 * @returns 规范化后的 OrchestrationPlan，校验失败返回 null
 */
export function normalizePlan(raw: unknown): OrchestrationPlan | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // summary：必填字符串，按码点安全截断至 100（避免截断 emoji 代理对）
  if (typeof obj.summary !== "string" || !obj.summary.trim()) return null;
  const summary = safeSlice(obj.summary, MAX_SUMMARY_LEN);

  // reasoning：必填字符串，按码点安全截断至 500
  if (typeof obj.reasoning !== "string" || !obj.reasoning.trim()) return null;
  const reasoning = safeSlice(obj.reasoning, MAX_REASONING_LEN);

  // actions：数组，最多 5 个
  if (!Array.isArray(obj.actions)) return null;
  const actions: AiAction[] = [];
  for (const item of obj.actions) {
    if (actions.length >= MAX_ACTIONS) break; // 超出 5 个截断
    if (item == null || typeof item !== "object") {
      console.warn("[orchestrator] normalizePlan 跳过非对象 action:", item);
      continue;
    }
    const a = item as Record<string, unknown>;
    if (typeof a.type !== "string" || !VALID_ACTION_TYPES.has(a.type)) {
      console.warn(
        "[orchestrator] normalizePlan 跳过非法 type action, type:",
        a.type,
      );
      continue;
    }
    if (!validateActionFields(a)) {
      console.warn(
        "[orchestrator] normalizePlan 跳过必填字段/枚举校验失败的 action, type:",
        a.type,
      );
      continue;
    }
    // validateActionFields 已校验必填字段 + 枚举值 + 可选字段类型，断言安全
    actions.push(a as AiAction);
  }

  return { summary, reasoning, actions };
}

/**
 * 聚合全量上下文 → LLM 建议联动方案（非流式，reasonerModel）。
 *
 * 流程：
 *  1. 在 runWithWorkspace 事务内聚合全量上下文（ORCHESTRATION_SCOPES，受 RLS 约束）
 *  2. generateText（reasonerModel + withCoT）生成联动方案 JSON
 *  3. cleanJsonResponse 去除代码块标记 → JSON.parse → normalizePlan 校验规范化
 *
 * @param wid 工作区 ID
 * @param userId 当前用户 ID
 * @param userRequest 用户可选的关注点（如"重点关注OKR风险"）
 * @returns 联动方案 OrchestrationPlan；LLM 输出无法解析时返回 null
 */
export async function suggestOrchestration(
  wid: string,
  userId: string,
  userRequest?: string,
): Promise<OrchestrationPlan | null> {
  // 1) 在 RLS 事务内聚合全量上下文
  const context = await runWithWorkspace(
    wid,
    (tx) => buildAiContext(wid, userId, ORCHESTRATION_SCOPES, tx),
    userId,
  );

  // 2) LLM 生成联动方案（非流式，推理模型）
  //    用 try-catch 包裹：LLM 调用可能因网络/限流/模型异常失败，
  //    catch 时记录错误并返回 null（降级：无建议方案），不向上抛异常
  let llmResult;
  try {
    llmResult = await generateText({
      model: reasonerModel,
      system: withCoT(buildOrchestrationSystemPrompt(), reasonerModel),
      prompt: buildOrchestrationUserPrompt(context, userRequest),
    });
  } catch (e) {
    console.error(
      "[orchestrator] generateText 调用失败:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  // 3) 解析 + 校验规范化
  const cleaned = cleanJsonResponse(llmResult.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error(
      "[orchestrator] JSON.parse 失败:",
      e,
      "raw:",
      cleaned.slice(0, 200),
    );
    return null;
  }
  const plan = normalizePlan(parsed);
  if (!plan) {
    console.error(
      "[orchestrator] normalizePlan 返回 null, raw:",
      cleaned.slice(0, 200),
    );
  }
  return plan;
}

/**
 * 执行联动方案——委托 executeAiActions 在 RLS 事务内原子执行。
 *
 * 所有操作在单个事务内顺序执行，任一失败全部回滚（原子性保证）。
 * 安全约束：调用方（API 路由）须确保用户已确认方案后才调用此函数。
 *
 * @param wid 工作区 ID
 * @param userId 操作发起人 ID
 * @param actions 待执行的操作列表（用户从建议方案中勾选的子集）
 * @returns 与 actions 等长的结果数组
 */
export async function executeOrchestration(
  wid: string,
  userId: string,
  actions: AiAction[],
): Promise<AiActionResult[]> {
  return executeAiActions(wid, userId, actions);
}