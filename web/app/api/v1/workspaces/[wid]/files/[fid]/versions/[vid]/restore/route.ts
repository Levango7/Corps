import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 云盘文件版本回滚 API · /api/v1/workspaces/{wid}/files/{fid}/versions/{vid}/restore
 * Phase 4A — 版本回滚
 *
 * - POST：将指定版本设为当前版本（更新 FileAsset.storageKey/currentVersion）
 *
 * 语义：回滚不删除后续版本，仅将 FileAsset 指向目标版本的 storageKey，
 * 并将 currentVersion 设为目标版本号。后续版本历史保留，用户可再次回滚。
 */

/** POST /v1/workspaces/{wid}/files/{fid}/versions/{vid}/restore — 版本回滚 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; fid: string; vid: string }> },
) {
  const { wid, fid, vid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文件存在且属于本工作区（防跨租户）
        const fileAsset = await tx.fileAsset.findFirst({
          where: { id: fid, workspaceId: wid },
          select: { id: true, currentVersion: true },
        });
        if (!fileAsset) return { kind: "fileNotFound" as const };

        // 校验版本存在且属于该文件
        const version = await tx.fileVersion.findFirst({
          where: { id: vid, fileAssetId: fid },
          select: { id: true, version: true, storageKey: true, fileSize: true },
        });
        if (!version) return { kind: "versionNotFound" as const };

        // 回滚：更新 FileAsset 指向目标版本的 storageKey/fileSize/currentVersion
        const updated = await tx.fileAsset.update({
          where: { id: fid },
          data: {
            storageKey: version.storageKey,
            fileSize: version.fileSize,
            currentVersion: version.version,
          },
          include: {
            uploader: { select: { id: true, name: true, email: true } },
            _count: { select: { versions: true } },
          },
        });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "fileNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "versionNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "fileNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    console.error("[POST file version restore] error:", error);
    return handlePrismaError(error, req);
  }
}