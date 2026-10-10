import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { authFailure } from "@/lib/auth-response";

/**
 * 云盘文件管理 API · /api/v1/workspaces/{wid}/files
 * Phase 4A — 文件资产列表
 *
 * - GET：列出工作区文件（支持 folderId 筛选 + 分页）
 */

/** 列表 query 参数校验 */
const listFilesQuerySchema = z.object({
  folderId: z.string().uuid().nullable().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /v1/workspaces/{wid}/files — 列出工作区文件（分页，支持 folderId 筛选） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
    const url = new URL(req.url);
    // folderId 支持空字符串表示根目录（folderId IS NULL）
    const folderIdRaw = url.searchParams.get("folderId");
    const parsed = listFilesQuerySchema.safeParse({
      folderId: folderIdRaw === null ? undefined : folderIdRaw === "" ? null : folderIdRaw,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.issues,
          data: null,
        },
        { status: 400 },
      );
    }
    const { folderId, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    // 构建筛选条件：folderId 精确匹配（null 表示根目录）
    const where: {
      workspaceId: string;
      folderId?: string | null;
    } = { workspaceId: wid };
    if (folderId !== undefined) where.folderId = folderId;

    const [items, total] = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.fileAsset.findMany({
            where,
            include: {
              uploader: { select: { id: true, name: true, email: true } },
              _count: { select: { versions: true } },
            },
            orderBy: { sortOrder: "asc" },
            skip,
            take: limit,
          }),
          tx.fileAsset.count({ where }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET files] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
