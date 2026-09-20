import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 回收站列表查询 searchParams 校验：
 *  - type: "task" | "document"（可选；不传返回全部）
 *  - page: 页码（默认 1）
 *  - limit: 每页数量（默认 20，最大 100）
 */
const listRecycleQuerySchema = z.object({
  type: z.enum(["task", "document"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** 回收站统一条目结构 */
interface RecycleItem {
  id: string;
  /** 条目类型：task | document */
  type: "task" | "document";
  /** 显示名称（Task 用 title，Document 用 title） */
  name: string;
  /** 软删除时间（ISO 字符串） */
  deletedAt: string;
  /** 删除人用户名（优先 name，回退 email；未知时为 null） */
  deletedBy: string | null;
}

/**
 * GET /v1/workspaces/{wid}/recycle-bin — 回收站列表
 *
 * 返回已软删除的 Task 和 Document（deletedAt IS NOT NULL）。
 * Query: ?type=task|document&page=1&limit=20
 *  - type=task：仅返回任务
 *  - type=document：仅返回文档
 *  - 不传 type：返回全部（任务 + 文档）
 *
 * 每条记录包含：id, name(title), type, deletedAt, deletedBy(用户名)
 * 按 deletedAt 倒序。统一分页响应：{ items, page, limit, total, hasMore }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listRecycleQuerySchema.safeParse({
      type: url.searchParams.get("type") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { type, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    // 分别查询已软删除的 Task 和 Document，附删除人用户名
    // 策略：按 type 过滤决定查哪些表；各表查 (limit + 1) 用于判断 hasMore
    // 当 type 未指定时，两表合并后按 deletedAt 倒序统一分页——
    // 简单稳妥的做法是两表全量拉取（带 deletedAt 倒序）后内存合并分页。
    // 回收站数据量通常较小（保留期 30 天），此方案可接受。
    // 安全限制：各表查询带 take 限制，防止极端情况下全量拉取。
    const wantTasks = type === undefined || type === "task";
    const wantDocs = type === undefined || type === "document";
    // 每表最多拉取 limit + 1 条用于判断 hasMore
    const queryTake = limit + 1;

    const [tasks, docs] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        wantTasks
          ? tx.task.findMany({
              where: { workspaceId: wid, deletedAt: { not: null } },
              select: {
                id: true,
                title: true,
                deletedAt: true,
                deletedBy: true,
              },
              orderBy: [{ deletedAt: "desc" }],
              take: queryTake,
            })
          : Promise.resolve([]),
        wantDocs
          ? tx.document.findMany({
              where: { workspaceId: wid, deletedAt: { not: null } },
              select: {
                id: true,
                title: true,
                deletedAt: true,
                deletedBy: true,
              },
              orderBy: [{ deletedAt: "desc" }],
              take: queryTake,
            })
          : Promise.resolve([]),
      ]),
    );

    // 收集所有 deletedBy userId，一次性查 User 表拿 name/email
    const userIds = new Set<string>();
    for (const t of tasks) if (t.deletedBy) userIds.add(t.deletedBy);
    for (const d of docs) if (d.deletedBy) userIds.add(d.deletedBy);

    const userMap = new Map<string, string>();
    if (userIds.size > 0) {
      const users = await runWithWorkspace(
        wid,
        (tx) =>
          tx.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, name: true, email: true },
          }),
        ctx.payload.sub,
      );
      for (const u of users) userMap.set(u.id, u.name || u.email);
    }

    // 合并为统一条目并按 deletedAt 倒序
    const allItems: RecycleItem[] = [];
    for (const t of tasks) {
      allItems.push({
        id: t.id,
        type: "task",
        name: t.title,
        deletedAt: t.deletedAt!.toISOString(),
        deletedBy: t.deletedBy ? (userMap.get(t.deletedBy) ?? null) : null,
      });
    }
    for (const d of docs) {
      allItems.push({
        id: d.id,
        type: "document",
        name: d.title,
        deletedAt: d.deletedAt!.toISOString(),
        deletedBy: d.deletedBy ? (userMap.get(d.deletedBy) ?? null) : null,
      });
    }
    allItems.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

    const total = allItems.length;
    const items = allItems.slice(skip, skip + limit);

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET recycle-bin] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}