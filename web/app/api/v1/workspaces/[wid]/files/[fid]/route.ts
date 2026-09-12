import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { promises as fs } from "fs";
import path from "path";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 云盘文件操作 API · /api/v1/workspaces/{wid}/files/{fid}
 * Phase 4A — 文件元信息 + 删除
 *
 * - GET：获取文件元信息
 * - DELETE：删除文件（级联删除所有版本 + 物理删除存储文件）
 */

/** 上传目录 */
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** GET /v1/workspaces/{wid}/files/{fid} — 获取文件元信息 */
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
    const fileAsset = await runWithWorkspace(
      wid,
      (tx) =>
        tx.fileAsset.findFirst({
          where: { id: fid, workspaceId: wid },
          include: {
            uploader: { select: { id: true, name: true, email: true } },
            _count: { select: { versions: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (!fileAsset) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: fileAsset });
  } catch (error) {
    console.error("[GET file] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/files/{fid} — 删除文件（级联删除版本 + 物理删除存储文件） */
export async function DELETE(
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
    // 先查询文件 + 所有版本的 storageKey（用于物理删除文件）
    const fileAsset = await runWithWorkspace(
      wid,
      (tx) =>
        tx.fileAsset.findFirst({
          where: { id: fid, workspaceId: wid },
          select: {
            id: true,
            uploadedBy: true,
            storageKey: true,
            thumbnailKey: true,
            versions: { select: { storageKey: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (!fileAsset) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
        { status: 404 },
      );
    }

    // RBAC 权限检查：仅 owner/admin 或文件上传者本人可删除
    const isOwnerOrAdmin =
      ctx.member.role === "owner" || ctx.member.role === "admin";
    const isUploader =
      fileAsset.uploadedBy != null && fileAsset.uploadedBy === ctx.payload.sub;
    if (!isOwnerOrAdmin && !isUploader) {
      return NextResponse.json(
        { code: 403, data: null, message: apiMsg(req, "forbidden") },
        { status: 403 },
      );
    }

    // 删除 FileAsset（级联删除所有 FileVersion）
    await runWithWorkspace(
      wid,
      (tx) => tx.fileAsset.delete({ where: { id: fid } }),
      ctx.payload.sub,
    );

    // 物理删除存储文件（best-effort，失败不影响 DB 删除结果）
    const storageKeys = new Set<string>([fileAsset.storageKey]);
    if (fileAsset.thumbnailKey) storageKeys.add(fileAsset.thumbnailKey);
    for (const v of fileAsset.versions) storageKeys.add(v.storageKey);

    for (const key of storageKeys) {
      const filePath = path.join(UPLOAD_DIR, key);
      await fs.unlink(filePath).catch(() => {});
    }

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE file] error:", error);
    return handlePrismaError(error, req);
  }
}