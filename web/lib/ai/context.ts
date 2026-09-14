// AI 上下文聚合器——按 scopes 聚合工作区数据，返回结构化 markdown 供 LLM 使用。
//
// 设计要点：
// - 每个 scope 有最大条数限制，超出截断并标注"(共 N 条，已截断至 M 条)"
// - 数据通过传入的 RLS 事务客户端 tx 查询，自动受行级安全策略约束（仅聚合用户有权限查看的数据）
// - 字段名映射基于 prisma/schema.prisma 实际定义：
//   · Task 无 completedAt，今日完成用 status="done" AND updatedAt>=todayStart 近似
//   · Meeting 用 scheduledAt（非 startAt）表示计划时间
//   · TimeEntry 用 startTime（非 date）记录工时起始
//   · Decision 无 title，取 markdown 前 80 字符作预览
//   · Message 用 body（非 content）存储正文

import type { Prisma } from "@prisma/client";
import { getFeedbackExamples, type FeedbackExample } from "@/lib/ai/feedback";

/** 上下文聚合范围 — 每个范围对应一组查询 */
export type AiContextScope =
  | "tasks:completed:today"
  | "tasks:blocked"
  | "tasks:overdue"
  | "documents:edited:today"
  | "meetings:today"
  | "approvals:handled:today"
  | "approvals:pending"
  | "okr:progress"
  | "time:today"
  | "time:week"
  | "wiki:edited:today"
  | "decisions:recent"
  | "im:recent"
  // ─── 细粒度 scope（v2 扩展）───
  | "tasks:created:today" // 今日新建任务
  | "tasks:high:priority" // 高优先级任务（priority=urgent 或 high）
  | "meetings:upcoming" // 即将到来的会议（未来 7 天）
  | "okr:at:risk" // 风险 OKR（进度落后于时间进度）
  | "approvals:overdue" // 逾期审批（创建超过 3 天未处理）
  | "im:unread" // 未读消息统计
  | "members:active"; // 活跃成员（最近 7 天有操作）

type Tx = Prisma.TransactionClient;

/** 当天 00:00:00.000（本地时区） */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** 次日 00:00:00.000（用于上界排除，避免 23:59:59.999 漏掉最后一毫秒） */
function startOfNextDay(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() + 1);
  return s;
}

/** 本周一 00:00:00（ISO 周历，周一为一周起始） */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const day = s.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const diff = day === 0 ? 6 : day - 1; // 回退到周一
  s.setDate(s.getDate() - diff);
  return s;
}

/** 解析 OKR 周期字符串（如 "2026-Q1"）为时间区间 [start, end) */
function parsePeriod(period: string): { start: Date; end: Date } | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1000) return null; // 防御：避免 JS Date 对 0-99 年的 1900 偏移
  const q = Number(m[2]);
  const startMonth = (q - 1) * 3; // Q1→0, Q2→3, Q3→6, Q4→9
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 1, 0, 0, 0, 0);
  return { start, end };
}

/** 截断标注：超出 max 时附加提示行 */
function truncationNote(total: number, max: number): string {
  return total > max ? `\n(共 ${total} 条，已截断至 ${max} 条)` : "";
}

/**
 * 日期 → YYYY-MM-DD（本地时区）。
 *
 * 用本地时区而非 UTC，与 startOfDay/startOfWeek/parsePeriod 保持一致——
 * 用户的"今日/本周/本季度"是本地时区概念，展示时间也应基于本地时区，
 * 否则 UTC+8 用户在凌晨 0-8 点会看到日期偏移一天。
 */
function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 日期 → HH:MM（本地时区）。
 *
 * 与 dateStr 同理，用本地时区与 startOfDay 保持一致。
 */
function timeStr(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

/** okr:at:risk scope 从 DB 拉取活跃目标的最大条数（在内存中再按时间进度过滤） */
const OKR_AT_RISK_TAKE = 200;

/** 各 scope 查询所需的日期上下文 */
interface DateCtx {
  todayStart: Date;
  tomorrowStart: Date;
  weekStart: Date;
  now: Date;
}

/** 含反馈示例的上下文结果（includeFeedback 启用时返回） */
export interface AiContextResult {
  /** 聚合后的 markdown 上下文（含反馈示例 section） */
  context: string;
  /** few-shot 反馈示例（仅 includeFeedback 启用且有数据时存在） */
  feedbackExamples?: FeedbackExample[];
}

/**
 * 将反馈示例格式化为 markdown section，供 LLM 作为 few-shot 参考。
 *
 * 格式：
 *   ## 反馈示例（用户修正后的好结果）
 *   - 原始输出: <originalOutput 摘要>
 *     修正输出: <correctedOutput 摘要>
 *     备注: <comment>
 */
function formatFeedbackExamples(examples: FeedbackExample[]): string {
  if (examples.length === 0) return "";
  const lines = examples.map((ex, i) => {
    const original = summarizeJson(ex.originalOutput);
    const corrected = summarizeJson(ex.correctedOutput);
    const comment = ex.comment ? `\n     备注: ${ex.comment}` : "";
    return `  ${i + 1}. 原始输出: ${original}\n     修正输出: ${corrected}${comment}`;
  });
  return `## 反馈示例（用户修正后的好结果）\n${lines.join("\n")}`;
}

/** 将 JSON 值摘要为单行字符串（截断至 200 字符，避免上下文膨胀） */
function summarizeJson(value: unknown): string {
  if (value === null || value === undefined) return "(空)";
  try {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return str.length > 200 ? str.slice(0, 200) + "…" : str;
  } catch {
    return "(无法序列化)";
  }
}

/**
 * 按 scopes 聚合工作区数据，返回结构化上下文字符串供 LLM 使用。
 *
 * 每个 scope 有最大条数限制，超出截断并标注。只聚合用户有权限查看的数据
 * （RLS 通过 tx 上下文约束——调用方应将 tx 置于 runWithWorkspace 事务内）。
 *
 * 重载说明：
 *  - 不传 includeFeedback（4 参数）→ 返回 string（向后兼容，现有调用方不受影响）
 *  - 传 includeFeedback=true → 返回 AiContextResult（含 context + feedbackExamples）
 *
 * @param wid 工作区 ID
 * @param userId 当前用户 ID（用于个人维度数据如工时）
 * @param scopes 需聚合的范围列表
 * @param tx RLS 事务客户端（由 runWithWorkspace 提供）
 * @param includeFeedback 是否注入反馈示例（few-shot），默认不启用
 * @param capability AI 能力标识；includeFeedback 为 true 时需提供以查询对应反馈
 * @returns 拼接后的 markdown 上下文字符串，或含反馈示例的 AiContextResult
 */
export async function buildAiContext(
  wid: string,
  userId: string,
  scopes: AiContextScope[],
  tx: Tx,
): Promise<string>;
export async function buildAiContext(
  wid: string,
  userId: string,
  scopes: AiContextScope[],
  tx: Tx,
  includeFeedback: true,
  capability?: string,
): Promise<AiContextResult>;
export async function buildAiContext(
  wid: string,
  userId: string,
  scopes: AiContextScope[],
  tx: Tx,
  includeFeedback?: boolean,
  capability?: string,
): Promise<string | AiContextResult> {
  const now = new Date();
  const dateCtx: DateCtx = {
    todayStart: startOfDay(now),
    tomorrowStart: startOfNextDay(now),
    weekStart: startOfWeek(now),
    now,
  };

  // 并行聚合所有 scope：各 scope 查询互不依赖，且已在 try-catch 中独立容错，
  // 用 Promise.all 并行执行可显著降低总延迟（原串行需累加 20 个 scope 的查询耗时）。
  // 注意：并行会增加瞬时 DB 连接数，若 RLS 事务客户端连接池较小需评估容量。
  const sections = await Promise.all(
    scopes.map(async (scope) => {
      try {
        const section = await buildSection(scope, wid, userId, tx, dateCtx);
        return section;
      } catch (e) {
        // 单个 scope 失败不中断整体上下文聚合，但记录警告便于排查
        console.warn(
          `[ai-context] scope "${scope}" 聚合失败:`,
          e instanceof Error ? e.message : e,
        );
        return null;
      }
    }),
  );
  const context = sections.filter((s): s is string => s !== null).join("\n\n");

  // 未启用反馈注入：返回 string（向后兼容）
  if (!includeFeedback) return context;

  // 启用反馈注入：获取 few-shot 示例并格式化为 markdown section
  try {
    const feedbackExamples = capability
      ? await getFeedbackExamples(wid, capability, 3, tx)
      : [];

    if (feedbackExamples.length === 0) {
      return { context, feedbackExamples: undefined };
    }

    const feedbackSection = formatFeedbackExamples(feedbackExamples);
    return {
      context: feedbackSection ? `${context}\n\n${feedbackSection}` : context,
      feedbackExamples,
    };
  } catch (e) {
    // 反馈查询失败不中断上下文聚合，仅记录警告
    console.warn(
      "[ai-context] 反馈示例获取失败:",
      e instanceof Error ? e.message : e,
    );
    return { context, feedbackExamples: undefined };
  }
}

/** 单个 scope 的查询 + 格式化 */
async function buildSection(
  scope: AiContextScope,
  wid: string,
  userId: string,
  tx: Tx,
  dc: DateCtx,
): Promise<string> {
  switch (scope) {
    case "tasks:completed:today": {
      // Task 无 completedAt 字段，用 status="done" AND updatedAt>=todayStart 近似今日完成
      const max = 50;
      const where = {
        workspaceId: wid,
        deletedAt: null,
        status: "done",
        updatedAt: { gte: dc.todayStart },
      };
      const [total, items] = await Promise.all([
        tx.task.count({ where }),
        tx.task.findMany({
          where,
          take: max,
          orderBy: { updatedAt: "desc" },
          select: { title: true, priority: true },
        }),
      ]);
      const lines = items.map((t) => `- ${t.title} (优先级: ${t.priority})`);
      return `## 任务（今日完成）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "tasks:blocked": {
      // 阻塞：blocked 标记为 true，或关联名为 "blocked" 的标签
      const max = 20;
      const where = {
        workspaceId: wid,
        deletedAt: null,
        OR: [{ blocked: true }, { labels: { some: { label: { name: "blocked" } } } }],
      };
      const [total, items] = await Promise.all([
        tx.task.count({ where }),
        tx.task.findMany({
          where,
          take: max,
          orderBy: { updatedAt: "desc" },
          select: { title: true, blockedReason: true },
        }),
      ]);
      const lines = items.map((t) =>
        `- ${t.title}${t.blockedReason ? `（原因：${t.blockedReason}）` : ""}`,
      );
      return `## 任务（阻塞）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "tasks:overdue": {
      // 逾期：截止日期已过且未完成
      const max = 20;
      const where = {
        workspaceId: wid,
        deletedAt: null,
        status: { not: "done" },
        dueDate: { lt: dc.now },
      };
      const [total, items] = await Promise.all([
        tx.task.count({ where }),
        tx.task.findMany({
          where,
          take: max,
          orderBy: { dueDate: "asc" },
          select: { title: true, dueDate: true, priority: true },
        }),
      ]);
      const lines = items.map(
        (t) =>
          `- ${t.title} (截止: ${t.dueDate ? dateStr(t.dueDate) : "?"}, 优先级: ${t.priority})`,
      );
      return `## 任务（逾期）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "documents:edited:today": {
      const max = 20;
      const where = {
        workspaceId: wid,
        deletedAt: null,
        updatedAt: { gte: dc.todayStart },
      };
      const [total, items] = await Promise.all([
        tx.document.count({ where }),
        tx.document.findMany({
          where,
          take: max,
          orderBy: { updatedAt: "desc" },
          select: { title: true, updatedAt: true },
        }),
      ]);
      const lines = items.map((d) => `- ${d.title} (更新于: ${dateStr(d.updatedAt)})`);
      return `## 文档（今日编辑）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "meetings:today": {
      // Meeting 用 scheduledAt 表示计划开始时间
      const max = 10;
      const where = {
        workspaceId: wid,
        scheduledAt: { gte: dc.todayStart, lt: dc.tomorrowStart },
      };
      const [total, items] = await Promise.all([
        tx.meeting.count({ where }),
        tx.meeting.findMany({
          where,
          take: max,
          orderBy: { scheduledAt: "asc" },
          select: { title: true, scheduledAt: true, status: true },
        }),
      ]);
      const lines = items.map(
        (m) =>
          `- ${m.title} (时间: ${m.scheduledAt ? timeStr(m.scheduledAt) : "?"}, 状态: ${m.status})`,
      );
      return `## 会议（今日）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "approvals:handled:today": {
      const max = 20;
      const where = {
        workspaceId: wid,
        updatedAt: { gte: dc.todayStart },
        status: { in: ["approved", "rejected"] },
      };
      const [total, items] = await Promise.all([
        tx.approvalInstance.count({ where }),
        tx.approvalInstance.findMany({
          where,
          take: max,
          orderBy: { updatedAt: "desc" },
          select: { title: true, status: true },
        }),
      ]);
      const lines = items.map(
        (a) => `- ${a.title} (结果: ${a.status === "approved" ? "通过" : "驳回"})`,
      );
      return `## 审批（今日处理）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "approvals:pending": {
      const max = 20;
      const where = {
        workspaceId: wid,
        status: "pending",
      };
      const [total, items] = await Promise.all([
        tx.approvalInstance.count({ where }),
        tx.approvalInstance.findMany({
          where,
          take: max,
          orderBy: { createdAt: "desc" },
          select: { title: true, submittedAt: true },
        }),
      ]);
      const lines = items.map((a) => `- ${a.title} (提交于: ${a.submittedAt ? dateStr(a.submittedAt) : "?"})`);
      return `## 审批（待处理）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "okr:progress": {
      const max = 20;
      const where = { workspaceId: wid };
      const [total, items] = await Promise.all([
        tx.objective.count({ where }),
        tx.objective.findMany({
          where,
          take: max,
          orderBy: { updatedAt: "desc" },
          select: {
            title: true,
            progress: true,
            status: true,
            period: true,
            keyResults: {
              select: { title: true, currentValue: true, targetValue: true, unit: true },
            },
          },
        }),
      ]);
      const lines = items.map((o) => {
        const krLines = o.keyResults
          .map((kr) => `  - ${kr.title}: ${kr.currentValue}/${kr.targetValue}${kr.unit ?? ""}`)
          .join("\n");
        return `- ${o.title} (${o.period}, 进度: ${o.progress}%, 状态: ${o.status})${krLines ? "\n" + krLines : ""}`;
      });
      return `## OKR 进度\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "time:today": {
      // TimeEntry 用 startTime 记录工时起始；按 userId 过滤个人工时
      const max = 50;
      const where = {
        workspaceId: wid,
        userId,
        startTime: { gte: dc.todayStart, lt: dc.tomorrowStart },
      };
      const [total, items] = await Promise.all([
        tx.timeEntry.count({ where }),
        tx.timeEntry.findMany({
          where,
          take: max,
          orderBy: { startTime: "desc" },
          select: { description: true, duration: true, billable: true },
        }),
      ]);
      const lines = items.map(
        (t) =>
          `- ${t.description ?? "(无描述)"} (时长: ${
            t.duration ? Math.round(t.duration / 60) + "分钟" : "进行中"
          }${t.billable ? ", 计费" : ""})`,
      );
      return `## 工时（今日）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "time:week": {
      // 本周工时聚合：总条数 + 总时长
      const where = {
        workspaceId: wid,
        userId,
        startTime: { gte: dc.weekStart },
      };
      const agg = await tx.timeEntry.aggregate({
        where,
        _sum: { duration: true },
        _count: true,
      });
      const totalMinutes = agg._sum.duration ? Math.round(agg._sum.duration / 60) : 0;
      return `## 工时（本周）\n- 总条数: ${agg._count}\n- 总时长: ${totalMinutes} 分钟`;
    }

    case "wiki:edited:today": {
      const max = 20;
      const where = {
        workspaceId: wid,
        updatedAt: { gte: dc.todayStart },
      };
      const [total, items] = await Promise.all([
        tx.wikiPage.count({ where }),
        tx.wikiPage.findMany({
          where,
          take: max,
          orderBy: { updatedAt: "desc" },
          select: { title: true, updatedAt: true },
        }),
      ]);
      const lines = items.map((w) => `- ${w.title} (更新于: ${dateStr(w.updatedAt)})`);
      return `## Wiki（今日编辑）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "decisions:recent": {
      // Decision 无 title 字段，取 markdown 前 80 字符作预览
      const max = 10;
      const where = { workspaceId: wid };
      const [total, items] = await Promise.all([
        tx.decision.count({ where }),
        tx.decision.findMany({
          where,
          take: max,
          orderBy: { createdAt: "desc" },
          select: { markdown: true, createdAt: true },
        }),
      ]);
      const lines = items.map((d) => {
        const preview = d.markdown.replace(/[#*\n]/g, " ").trim().slice(0, 80);
        return `- ${preview || "(空决策)"} (时间: ${dateStr(d.createdAt)})`;
      });
      return `## 决策（最近）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "im:recent": {
      // Message 用 body 存储正文，author 关联 User
      const max = 50;
      const where = { workspaceId: wid };
      const [total, items] = await Promise.all([
        tx.message.count({ where }),
        tx.message.findMany({
          where,
          take: max,
          orderBy: { createdAt: "desc" },
          select: {
            body: true,
            createdAt: true,
            author: { select: { name: true } },
          },
        }),
      ]);
      const lines = items.map((m) => {
        const author = m.author?.name ?? "未知";
        const body = m.body.length > 100 ? m.body.slice(0, 100) + "…" : m.body;
        return `- [${timeStr(m.createdAt)}] ${author}: ${body}`;
      });
      return `## 消息（最近）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    // ─── 细粒度 scope（v2 扩展）───

    case "tasks:created:today": {
      // 今日新建任务：createdAt >= 当天 00:00
      const max = 30;
      const where = {
        workspaceId: wid,
        deletedAt: null,
        createdAt: { gte: dc.todayStart },
      };
      const [total, items] = await Promise.all([
        tx.task.count({ where }),
        tx.task.findMany({
          where,
          take: max,
          orderBy: { createdAt: "desc" },
          select: { title: true, priority: true },
        }),
      ]);
      const lines = items.map((t) => `- ${t.title} (优先级: ${t.priority})`);
      return `## 任务（今日新建）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "tasks:high:priority": {
      // 高优先级未完成任务：priority 为 urgent 或 high，且 status != done
      const max = 30;
      const where = {
        workspaceId: wid,
        deletedAt: null,
        status: { not: "done" },
        priority: { in: ["urgent", "high"] },
      };
      const [total, items] = await Promise.all([
        tx.task.count({ where }),
        tx.task.findMany({
          where,
          take: max,
          // 注：priority desc 排序依赖枚举值字母序（urgent > high > medium > low），新增 priority 值时须确保字母序与优先级一致
          orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
          select: { title: true, priority: true, dueDate: true },
        }),
      ]);
      const lines = items.map(
        (t) =>
          `- ${t.title} (优先级: ${t.priority}${t.dueDate ? `, 截止: ${dateStr(t.dueDate)}` : ""})`,
      );
      return `## 任务（高优先级）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "meetings:upcoming": {
      // 即将到来的会议：scheduledAt 在 now 到 now+7 天之间
      // Meeting 无 location 字段，用 status 辅助展示
      const max = 10;
      const weekEnd = new Date(dc.now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const where = {
        workspaceId: wid,
        scheduledAt: { gte: dc.now, lt: weekEnd },
      };
      const [total, items] = await Promise.all([
        tx.meeting.count({ where }),
        tx.meeting.findMany({
          where,
          take: max,
          orderBy: { scheduledAt: "asc" },
          select: { title: true, scheduledAt: true, status: true },
        }),
      ]);
      const lines = items.map(
        (m) =>
          `- ${m.title} (时间: ${m.scheduledAt ? `${dateStr(m.scheduledAt)} ${timeStr(m.scheduledAt)}` : "?"}, 状态: ${m.status})`,
      );
      return `## 会议（未来 7 天）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "okr:at:risk": {
      // 风险 OKR：活跃目标中，完成进度落后于时间进度超过 20 个百分点
      // 时间进度由 period（如 "2026-Q1"）解析的区间与 now 计算
      const max = 10;
      const where = { workspaceId: wid, status: "active" };
      // 先取最多 OKR_AT_RISK_TAKE 条活跃目标，再在内存中按时间进度过滤
      // （无法在 DB 层表达"时间进度 - 完成进度 > 20"这一计算条件）
      const items = await tx.objective.findMany({
        where,
        take: OKR_AT_RISK_TAKE,
        orderBy: { updatedAt: "desc" },
        select: {
          title: true,
          progress: true,
          period: true,
          keyResults: {
            select: { title: true, currentValue: true, targetValue: true, unit: true },
          },
        },
      });
      const atRiskAll = items.filter((o) => {
        const p = parsePeriod(o.period);
        if (!p) return false;
        const span = p.end.getTime() - p.start.getTime();
        if (span <= 0) return false;
        const elapsed = dc.now.getTime() - p.start.getTime();
        if (elapsed <= 0) return false; // 周期尚未开始
        const timeProgress = (elapsed / span) * 100;
        // 时间进度已推进但完成进度落后超过 20 个百分点
        return timeProgress - o.progress > 20;
      });
      // P1 修复：在 slice 之前保存原始长度，否则 slice(0, max) 后
      // atRisk.length 恒 ≤ max，truncationNote 永远不会显示截断提示
      const totalAtRisk = atRiskAll.length;
      const atRisk = atRiskAll.slice(0, max);
      const lines = atRisk.map((o) => {
        const krLines = o.keyResults
          .map((kr) => `  - ${kr.title}: ${kr.currentValue}/${kr.targetValue}${kr.unit ?? ""}`)
          .join("\n");
        return `- ${o.title} (${o.period}, 进度: ${o.progress}%)${krLines ? "\n" + krLines : ""}`;
      });
      return `## OKR（风险）\n${lines.join("\n") || "无"}${truncationNote(totalAtRisk, max)}`;
    }

    case "approvals:overdue": {
      // 逾期审批：status=pending 且提交超过 3 天未处理
      const max = 20;
      const threeDaysAgo = new Date(dc.now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const where = {
        workspaceId: wid,
        status: "pending",
        submittedAt: { lt: threeDaysAgo },
      };
      const [total, items] = await Promise.all([
        tx.approvalInstance.count({ where }),
        tx.approvalInstance.findMany({
          where,
          take: max,
          orderBy: { createdAt: "asc" },
          select: { title: true, submittedAt: true },
        }),
      ]);
      const lines = items.map((a) => `- ${a.title} (提交于: ${a.submittedAt ? dateStr(a.submittedAt) : "?"})`);
      return `## 审批（逾期未处理）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "im:unread": {
      // 未读消息：当前用户没有对应 MessageRead 记录的消息
      // Message 无 readAt 字段，通过 reads 关联表 none 过滤判断未读
      const max = 5;
      const where = {
        workspaceId: wid,
        reads: { none: { userId } },
      };
      const [total, items] = await Promise.all([
        tx.message.count({ where }),
        tx.message.findMany({
          where,
          take: max,
          orderBy: { createdAt: "desc" },
          select: {
            body: true,
            createdAt: true,
            author: { select: { name: true } },
          },
        }),
      ]);
      const lines = items.map((m) => {
        const author = m.author?.name ?? "未知";
        const body = m.body.length > 100 ? m.body.slice(0, 100) + "…" : m.body;
        return `- [${timeStr(m.createdAt)}] ${author}: ${body}`;
      });
      return `## 消息（未读）\n未读共 ${total} 条\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    case "members:active": {
      // 活跃成员：最近 7 天有操作（通过关联 User.updatedAt 判断）
      // Member 无 updatedAt 字段，借助 user 关联的 updatedAt 近似活跃度
      const max = 20;
      const weekAgo = new Date(dc.now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const where = {
        workspaceId: wid,
        user: { updatedAt: { gte: weekAgo } },
      };
      const [total, items] = await Promise.all([
        tx.member.count({ where }),
        tx.member.findMany({
          where,
          take: max,
          orderBy: { joinedAt: "desc" },
          select: { role: true, user: { select: { name: true, email: true } } },
        }),
      ]);
      const lines = items.map((m) => `- ${m.user.name ?? m.user.email ?? "未知用户"} (角色: ${m.role})`);
      return `## 成员（活跃）\n${lines.join("\n") || "无"}${truncationNote(total, max)}`;
    }

    default: {
      // 穷尽性检查：新增 scope 时若忘记处理此处会编译报错
      const _exhaustive: never = scope;
      return _exhaustive;
    }
  }
}