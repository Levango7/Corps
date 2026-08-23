import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";

/**
 * 决策列表 API（跨任务聚合）
 * - GET /v1/workspaces/{wid}/decisions?page=1&limit=20&q=keyword
 *
 * 返回当前工作区内所有任务的决策记录，按 createdAt 降序分页。
 * q 参数对 markdown 内容做大小写不敏感搜索（PostgreSQL ilike 语义）。
 * join Task 取 taskTitle、join User 取 authorName。
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePagination(url: URL) {
  const pageRaw = Number(url.searchParams.get("page"));
  const limitRaw = Number(url.searchParams.get("limit"));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : DEFAULT_PAGE;
  const limit =
    Number.isFinite(limitRaw) && limitRaw >= 1
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
}

/** GET /v1/workspaces/{wid}/decisions */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const { limit, skip } = parsePagination(url);

  // 公共 where 子句：限定工作区 + 可选 markdown ilike
  const where = {
    workspaceId: wid,
    ...(q ? { markdown: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [total, rows] = await runWithWorkspace(wid, (tx) =>
    Promise.all([
      tx.decision.count({ where }),
      tx.decision.findMany({
        where,
        select: {
          id: true,
          markdown: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          taskId: true,
          authorId: true,
          task: { select: { title: true } },
          author: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]),
  );

  // 拍平为前端期望的 taskTitle / authorName 字段
  const decisions = rows.map((d) => ({
    id: d.id,
    taskId: d.taskId,
    taskTitle: d.task.title,
    markdown: d.markdown,
    version: d.version,
    authorId: d.authorId,
    authorName: d.author.name ?? "",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));

  return NextResponse.json({ code: 200, data: { decisions, total } });
}
