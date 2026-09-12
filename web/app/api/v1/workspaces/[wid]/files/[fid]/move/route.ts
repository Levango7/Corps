import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 云盘文件移动 API · /api/v1/workspaces/{wid}/files/{fid}/move
 * Phase 4A — 移动文件到指定文件夹
 *
 * - PATCH：更新 folderId（null 表示移动到根目录）
 */

const moveFileSchema = z.object({
  /** 目标文件夹 ID（null = 移动到根目录） */
  folderId: z.string().uuid().nullable(),
  /** 可选：同层级排序值 */
  sortOrder: z.number().optional(),
});

/** PATCH /v1/workspaces/{wid}/files/{fid}/move — 移动文件到指定文件夹 */
export async function PATCH(
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
    const body = await req.json();
    const validated = moveFileSchema.parse(body);

    // 校验文件存在且属于本工作区（防跨租户）
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.fileAsset.findFirst({
          where: { id: fid, workspaceId: wid },
          select: { id: true },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
        { status: 404 },
      );
    }

    // 更新 folderId（可选 sortOrder）
    const data: { folderId: string | null; sortOrder?: number } = {
      folderId: validated.folderId,
    };
    if (validated.sortOrder !== undefined) data.sortOrder = validated.sortOrder;

    const fileAsset = await runWithWorkspace(
      wid,
      (tx) =>
        tx.fileAsset.update({
          where: { id: fid },
          data,
          include: {
            uploader: { select: { id: true, name: true, email: true } },
            _count: { select: { versions: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: fileAsset });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    console.error("[PATCH file move] error:", error);
    return handlePrismaError(error, req);
  }
}