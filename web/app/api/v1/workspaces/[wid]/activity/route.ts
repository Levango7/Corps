import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { logger } from "@/lib/logger";

/**
 * M4 实时协作基础：工作区活动流 API
 *
 * GET /v1/workspaces/{wid}/activity — 查询最近活动
 *
 * 聚合工作区内多张表的最近变更，按时间倒序返回统一活动流：
 *  - task.created：任务创建（Task.createdAt）
 *  - task.updated：任务更新（Task.updatedAt，排除刚创建的）
 *  - comment.created：评论发表（Comment.createdAt）
 *  - decision.created：决策创建（Decision.createdAt）
 *  - decision.updated：决策更新（Decision.updatedAt，排除刚创建的）
 *
 * 分页：take 20，?cursor=ISO 时间戳（返回早于 cursor 的活动）。
 *
 * 认证：getWorkspaceContext 校验工作区成员身份 + RLS 上下文。
 * RLS：通过 runWithWorkspace 注入工作区上下文，跨工作区请求被拦截。
 *
 * 响应：{ code: 0, data: { items: Activity[], nextCursor: string | null }, message }
 * Activity: { id, type, actorId, actorName, entityType, entityId, entityTitle, createdAt }
 */

/** 单页活动数 */
const PAGE_SIZE = 20;

/** 统一活动项 */
interface Activity {
  id: string;
  type: "task.created" | "task.updated" | "comment.created" | "decision.created" | "decision.updated";
  actorId: string | null;
  actorName: string | null;
  entityType: "task" | "comment" | "decision";
  entityId: string;
  entityTitle: string;
  createdAt: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const userId = ctx.payload.sub;
    const cursorParam = req.nextUrl.searchParams.get("cursor");
    const cursor = cursorParam ? new Date(cursorParam) : null;
    const cursorValid = cursor && !Number.isNaN(cursor.getTime());

    // 在单个事务内并发查询 5 类活动源，各取最近 PAGE_SIZE 条，
    // 内存合并 + 排序 + 截断 PAGE_SIZE，避免跨表 JOIN 复杂性。
    // 每类查询都按 workspaceId 隔离（RLS + where 双保险）。
    // 注意：Prisma 不支持同行字段间比较（updatedAt > createdAt），
    // 故 task.updated / decision.updated 拉取后在内存过滤掉 updatedAt === createdAt 的项
    // （说明从未被修改过，仅创建时写入，不应作为"更新"活动出现）。
    const [tasksCreated, tasksUpdated, comments, decisionsCreated, decisionsUpdated] =
      await runWithWorkspace(
        wid,
        async (tx) => {
          // 公共 where：cursor 分页（早于 cursor 的活动）
          const timeWhere = cursorValid ? { createdAt: { lt: cursor! } } : {};
          const updateTimeWhere = cursorValid ? { updatedAt: { lt: cursor! } } : {};

          return Promise.all([
            // 1. 任务创建（Task.createdAt）
            tx.task.findMany({
              where: { workspaceId: wid, ...timeWhere },
              select: {
                id: true,
                title: true,
                createdBy: true,
                createdAt: true,
                updatedAt: true,
                creator: { select: { name: true } },
              },
              orderBy: { createdAt: "desc" },
              take: PAGE_SIZE,
            }),
            // 2. 任务更新（Task.updatedAt，内存过滤排除刚创建的）
            tx.task.findMany({
              where: { workspaceId: wid, ...updateTimeWhere },
              select: {
                id: true,
                title: true,
                createdBy: true,
                createdAt: true,
                updatedAt: true,
                creator: { select: { name: true } },
              },
              orderBy: { updatedAt: "desc" },
              take: PAGE_SIZE,
            }),
            // 3. 评论发表（Comment.createdAt）
            tx.comment.findMany({
              where: { workspaceId: wid, ...timeWhere },
              select: {
                id: true,
                body: true,
                taskId: true,
                authorId: true,
                createdAt: true,
                author: { select: { name: true } },
                task: { select: { title: true } },
              },
              orderBy: { createdAt: "desc" },
              take: PAGE_SIZE,
            }),
            // 4. 决策创建（Decision.createdAt）
            tx.decision.findMany({
              where: { workspaceId: wid, ...timeWhere },
              select: {
                id: true,
                taskId: true,
                authorId: true,
                createdAt: true,
                updatedAt: true,
                author: { select: { name: true } },
                task: { select: { title: true } },
              },
              orderBy: { createdAt: "desc" },
              take: PAGE_SIZE,
            }),
            // 5. 决策更新（Decision.updatedAt，内存过滤排除刚创建的）
            tx.decision.findMany({
              where: { workspaceId: wid, ...updateTimeWhere },
              select: {
                id: true,
                taskId: true,
                authorId: true,
                createdAt: true,
                updatedAt: true,
                author: { select: { name: true } },
                task: { select: { title: true } },
              },
              orderBy: { updatedAt: "desc" },
              take: PAGE_SIZE,
            }),
          ]);
        },
        userId,
      );

    // 合并为统一活动项
    const activities: Activity[] = [
      ...tasksCreated.map((t) => ({
        id: `task.created:${t.id}`,
        type: "task.created" as const,
        actorId: t.createdBy,
        actorName: t.creator?.name ?? null,
        entityType: "task" as const,
        entityId: t.id,
        entityTitle: t.title,
        createdAt: t.createdAt.toISOString(),
      })),
      // 任务更新：过滤掉 updatedAt === createdAt（从未被修改，仅创建时写入）
      ...tasksUpdated
        .filter((t) => t.updatedAt.getTime() !== t.createdAt.getTime())
        .map((t) => ({
          id: `task.updated:${t.id}:${t.updatedAt.getTime()}`,
          type: "task.updated" as const,
          actorId: t.createdBy,
          actorName: t.creator?.name ?? null,
          entityType: "task" as const,
          entityId: t.id,
          entityTitle: t.title,
          createdAt: t.updatedAt.toISOString(),
        })),
      ...comments.map((c) => ({
        id: `comment.created:${c.id}`,
        type: "comment.created" as const,
        actorId: c.authorId,
        actorName: c.author?.name ?? null,
        entityType: "comment" as const,
        entityId: c.id,
        entityTitle: c.task.title,
        createdAt: c.createdAt.toISOString(),
      })),
      ...decisionsCreated.map((d) => ({
        id: `decision.created:${d.id}`,
        type: "decision.created" as const,
        actorId: d.authorId,
        actorName: d.author?.name ?? null,
        entityType: "decision" as const,
        entityId: d.id,
        entityTitle: d.task.title,
        createdAt: d.createdAt.toISOString(),
      })),
      // 决策更新：过滤掉 updatedAt === createdAt
      ...decisionsUpdated
        .filter((d) => d.updatedAt.getTime() !== d.createdAt.getTime())
        .map((d) => ({
          id: `decision.updated:${d.id}:${d.updatedAt.getTime()}`,
          type: "decision.updated" as const,
          actorId: d.authorId,
          actorName: d.author?.name ?? null,
          entityType: "decision" as const,
          entityId: d.id,
          entityTitle: d.task.title,
          createdAt: d.updatedAt.toISOString(),
        })),
    ];

    // 按时间倒序排序 + 截断 PAGE_SIZE
    activities.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const items = activities.slice(0, PAGE_SIZE);

    // nextCursor：最后一项的 createdAt，前端用它请求下一页
    const nextCursor = items.length === PAGE_SIZE ? items[items.length - 1].createdAt : null;

    return NextResponse.json({
      code: 200,
      data: { items, nextCursor },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    logger.error("[GET activity] error", { wid, error: String(error) });
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}