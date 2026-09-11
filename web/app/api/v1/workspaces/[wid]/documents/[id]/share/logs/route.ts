// F5：文档分享访问日志路由
// GET /api/v1/workspaces/{wid}/documents/{id}/share/logs
//
// 返回分享访问日志（分页 page + pageSize），按 accessedAt 倒序。
// 仅 owner/admin 可调用。
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** GET /v1/workspaces/{wid}/documents/{id}/share/logs — 分页访问日志 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // 仅 owner/admin 可查看访问日志
  if (ctx.member.role !== "owner" && ctx.member.role !== "admin") {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "forbidden"), data: null },
      { status: 403 },
    );
  }

  try {
    // 分页参数解析（容错：非数字回退默认值）
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        parseInt(url.searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) ||
          DEFAULT_PAGE_SIZE,
      ),
    );

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 先确认文档存在且属于该工作区
        const doc = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!doc) return { kind: "notFound" as const };

        const [logs, total] = await Promise.all([
          tx.shareAccessLog.findMany({
            where: { entityType: "document", entityId: id },
            orderBy: { accessedAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.shareAccessLog.count({
            where: { entityType: "document", entityId: id },
          }),
        ]);

        return { kind: "ok" as const, logs, total };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: {
        items: result.logs,
        pagination: {
          page,
          pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / pageSize),
        },
      },
    });
  } catch (error) {
    console.error("[GET document share/logs] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}