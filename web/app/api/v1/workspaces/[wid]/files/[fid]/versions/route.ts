import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 云盘文件版本历史 API · /api/v1/workspaces/{wid}/files/{fid}/versions
 * Phase 4A — 文件版本列表
 *
 * - GET：列出文件版本历史（分页，按版本号倒序）
 */

/** 列表 query 参数校验 */
const listVersionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /v1/workspaces/{wid}/files/{fid}/versions — 版本历史列表（分页） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; fid: string }> },
) {
  const { wid, fid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = listVersionsQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文件存在且属于本工作区（防跨租户读取）
        const fileAsset = await tx.fileAsset.findFirst({
          where: { id: fid, workspaceId: wid },
          select: { id: true, currentVersion: true },
        });
        if (!fileAsset) return null;

        const [versions, total] = await Promise.all([
          tx.fileVersion.findMany({
            where: { fileAssetId: fid },
            include: { uploader: { select: { id: true, name: true, email: true } } },
            orderBy: { version: "desc" },
            skip,
            take: limit,
          }),
          tx.fileVersion.count({ where: { fileAssetId: fid } }),
        ]);
        return { versions, total, currentVersion: fileAsset.currentVersion };
      },
      ctx.payload.sub,
    );

    if (result === null) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: {
        items: result.versions,
        page,
        limit,
        total: result.total,
        hasMore: page * limit < result.total,
        currentVersion: result.currentVersion,
      },
    });
  } catch (error) {
    console.error("[GET file versions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}