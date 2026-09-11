import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";
import { requirePermission } from "@/lib/permissions";

type Tx = Prisma.TransactionClient;

/**
 * F3 Widget 仪表盘 — 单个 Widget 数据按需加载。
 *
 * GET /api/v1/workspaces/:wid/dashboard/widgets/:widgetId
 *   → 返回指定 Widget 的数据（避免首屏全量加载）
 *
 * widgetId ∈ { task-stats, my-tasks, decision-actions, due-this-week,
 *              team-load, burndown, priority-dist, recent-activity }
 *
 * 权限：
 *  - team-load / burndown 需 analytics:read（owner/admin 默认可见）
 *  - 其余 widget 所有成员可见
 *
 * 认证：getWorkspaceContext 校验成员身份 + 注入 RLS。
 */

/** 允许的 widgetId 白名单 */
const WIDGET_IDS = new Set([
  "task-stats",
  "my-tasks",
  "decision-actions",
  "due-this-week",
  "team-load",
  "burndown",
  "priority-dist",
  "recent-activity",
]);

/** 需要 analytics:read 权限的 widget */
const ANALYTICS_WIDGETS = new Set(["team-load", "burndown"]);

/** 燃尽图时间窗口（天） */
const BURNDOWN_DAYS = 14;
const MS_PER_DAY = 86_400_000;

/**
 * GET /api/v1/workspaces/:wid/dashboard/widgets/:widgetId
 * 响应：{ code: 200, data: { widget: widgetId, data: any } }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; widgetId: string }> },
) {
  const { wid, widgetId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // widgetId 白名单校验
  if (!WIDGET_IDS.has(widgetId)) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  // team-load / burndown 需 analytics:read 权限
  if (ANALYTICS_WIDGETS.has(widgetId)) {
    const denied = await requirePermission(ctx, "analytics", "read", req);
    if (denied) return denied;
  }

  try {
    const userId = ctx.payload.sub;
    const data = await runWithWorkspace(
      wid,
      (tx) => loadWidgetData(tx, wid, userId, widgetId),
      userId,
    );

    return NextResponse.json({ code: 200, data: { widget: widgetId, data } });
  } catch (error) {
    console.error(`[GET dashboard/widgets/${widgetId}] error:`, error);
    return handlePrismaError(error, req);
  }
}


/**
 * 按 widgetId 分发到对应数据加载器。
 * 各加载器返回任意结构（由前端 Widget 组件约定消费形态）。
 */
async function loadWidgetData(
  tx: Tx,
  wid: string,
  userId: string,
  widgetId: string,
): Promise<unknown> {
  switch (widgetId) {
    case "task-stats":
      return loadTaskStats(tx, wid);
    case "my-tasks":
      return loadMyTasks(tx, wid, userId);
    case "decision-actions":
      return loadDecisionActions(tx, wid);
    case "due-this-week":
      return loadDueThisWeek(tx, wid);
    case "team-load":
      return loadTeamLoad(tx, wid);
    case "burndown":
      return loadBurndown(tx, wid);
    case "priority-dist":
      return loadPriorityDist(tx, wid);
    case "recent-activity":
      return loadRecentActivity(tx, wid, userId);
    default:
      return null;
  }
}

// ─── Widget 数据加载器 ───

/** task-stats：聚合任务统计（按状态分组计数） */
async function loadTaskStats(tx: Tx, wid: string) {
  const grouped = await tx.task.groupBy({
    by: ["status"],
    where: { workspaceId: wid, parentId: null },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { todo: 0, in_progress: 0, review: 0, done: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
  }
  const total = counts.todo + counts.in_progress + counts.review + counts.done;
  return { ...counts, total };
}

/** my-tasks：当前用户分配的任务（取最近 10 条） */
async function loadMyTasks(tx: Tx, wid: string, userId: string) {
  const tasks = await tx.task.findMany({
    where: { workspaceId: wid, assigneeId: userId, parentId: null },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      blocked: true,
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 10,
  });
  return { items: tasks };
}

/** decision-actions：决策行动项待执行列表（checked=false 且 removed=false） */
async function loadDecisionActions(tx: Tx, wid: string) {
  const items = await tx.decisionActionItem.findMany({
    where: {
      checked: false,
      removed: false,
      decision: { workspaceId: wid },
    },
    select: {
      id: true,
      title: true,
      checked: true,
      assigneeId: true,
      dueDate: true,
      priority: true,
      decisionId: true,
      taskId: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return { items };
}

/** due-this-week：本周截止任务（dueDate 在本周内且未完成） */
async function loadDueThisWeek(tx: Tx, wid: string) {
  const { start, end } = thisWeekRange();
  const tasks = await tx.task.findMany({
    where: {
      workspaceId: wid,
      parentId: null,
      dueDate: { gte: start, lte: end },
      status: { not: "done" },
    },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      assigneeId: true,
      dueDate: true,
    },
    orderBy: { dueDate: "asc" },
    take: 20,
  });
  return { items: tasks, weekStart: start.toISOString(), weekEnd: end.toISOString() };
}

/** team-load：团队成员负载（每人按状态分组的任务数） */
async function loadTeamLoad(tx: Tx, wid: string) {
  const members = await tx.member.findMany({
    where: { workspaceId: wid },
    select: {
      userId: true,
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  // 按指派人分组统计任务数
  const grouped = await tx.task.groupBy({
    by: ["assigneeId", "status"],
    where: { workspaceId: wid, parentId: null, assigneeId: { not: null } },
    _count: { _all: true },
  });
  // 组装每人负载
  const loadMap = new Map<string, Record<string, number>>();
  for (const g of grouped) {
    if (!g.assigneeId) continue;
    if (!loadMap.has(g.assigneeId)) {
      loadMap.set(g.assigneeId, { todo: 0, in_progress: 0, review: 0, done: 0, total: 0 });
    }
    const entry = loadMap.get(g.assigneeId)!;
    entry[g.status] = g._count._all;
    entry.total += g._count._all;
  }
  const items = members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    load: loadMap.get(m.userId) ?? { todo: 0, in_progress: 0, review: 0, done: 0, total: 0 },
  }));
  return { items };
}

/** burndown：燃尽图数据（最近 14 天每日剩余任务数） */
async function loadBurndown(tx: Tx, wid: string) {
  const now = Date.now();
  const windowStart = new Date(now - BURNDOWN_DAYS * MS_PER_DAY);

  // 拉取窗口内相关任务（创建于窗口结束前的所有顶层任务）
  // 为控制数据量，仅取窗口内创建或状态变更的任务
  const tasks = await tx.task.findMany({
    where: {
      workspaceId: wid,
      parentId: null,
      OR: [{ createdAt: { gte: windowStart } }, { updatedAt: { gte: windowStart } }],
    },
    select: { id: true, status: true, createdAt: true, updatedAt: true },
    take: 5_000,
  });

  // 总任务数（不受窗口截断影响，独立 count）
  const totalTasks = await tx.task.count({ where: { workspaceId: wid, parentId: null } });

  // 按天统计：total（到该天结束为止创建的任务数）、done（到该天结束为止完成的任务数）
  const days: { date: string; total: number; done: number; remaining: number }[] = [];
  for (let i = 0; i < BURNDOWN_DAYS; i++) {
    const dayEnd = new Date(now - (BURNDOWN_DAYS - 1 - i) * MS_PER_DAY);
    dayEnd.setHours(23, 59, 59, 999);
    const dayEndMs = dayEnd.getTime();
    const dateStr = dayEnd.toISOString().slice(0, 10);

    let created = 0;
    let completed = 0;
    for (const t of tasks) {
      if (t.createdAt.getTime() <= dayEndMs) created++;
      // 完成近似：当前 status=done 且 updatedAt <= dayEnd（无独立 doneAt 字段）
      if (t.status === "done" && t.updatedAt.getTime() <= dayEndMs) completed++;
    }
    // 窗口截断修正：total 用独立 count 的值在最后一天对齐
    const total = i === BURNDOWN_DAYS - 1 ? totalTasks : created;
    const remaining = Math.max(0, total - completed);
    days.push({ date: dateStr, total, done: completed, remaining });
  }
  return { days, totalTasks };
}

/** priority-dist：优先级分布统计 */
async function loadPriorityDist(tx: Tx, wid: string) {
  const grouped = await tx.task.groupBy({
    by: ["priority"],
    where: { workspaceId: wid, parentId: null },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
  for (const g of grouped) {
    counts[g.priority] = g._count._all;
  }
  const total = counts.low + counts.medium + counts.high + counts.urgent;
  return { ...counts, total };
}

/** recent-activity：最近通知（取 10 条） */
async function loadRecentActivity(tx: Tx, wid: string, userId: string) {
  const notifications = await tx.notification.findMany({
    where: { userId, workspaceId: wid },
    select: {
      id: true,
      type: true,
      entityId: true,
      entityTitle: true,
      read: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  return { items: notifications };
}

// ─── 工具函数 ───

/** 计算本周一 00:00 到本周日 23:59:59 的时间范围（本地时区） */
function thisWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
  // 转换为周一为起点的偏移：周一=0, 周日=6
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const start = new Date(now);
  start.setDate(now.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}