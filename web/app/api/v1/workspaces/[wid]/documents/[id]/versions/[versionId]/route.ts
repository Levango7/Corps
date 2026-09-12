import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 文档版本详情 API · /api/v1/workspaces/{wid}/documents/{id}/versions/{versionId}
 * 设计文档 §2.3.3
 *
 * - GET：获取特定版本详情
 * - POST：回滚到指定版本（将版本的 markdown 写回文档，并创建一个新的版本快照记录回滚操作）
 */

/** GET /v1/workspaces/{wid}/documents/{id}/versions/{versionId} — 版本详情 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; versionId: string }> },
) {
  const { wid, id, versionId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const version = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文档存在且属于本工作区（防跨租户读取）
        const doc = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!doc) return null;

        return tx.documentVersion.findFirst({
          where: { id: versionId, documentId: id, workspaceId: wid },
          include: { author: { select: { id: true, name: true, email: true } } },
        });
      },
      ctx.payload.sub,
    );

    if (version === null) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    if (version === undefined) {
      // doc 存在但 version 不存在
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: version });
  } catch (error) {
    console.error("[GET document version] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * POST /v1/workspaces/{wid}/documents/{id}/versions/{versionId} — 回滚到指定版本
 * 权限：documents 模块 update 权限（owner/admin/member 均可）
 *
 * 语义：
 *  1. 读取目标版本的 markdown
 *  2. 将其写回文档的 markdown 字段（草稿）
 *  3. 创建一个新的版本快照记录此次回滚操作（版本号继续递增，source=manual）
 *  4. 返回新版本快照
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; versionId: string }> },
) {
  const { wid, id, versionId } = await params;
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
        // 校验文档存在且属于本工作区
        const docExists = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!docExists) return { kind: "docNotFound" as const, data: null };

        // 读取目标版本
        const targetVersion = await tx.documentVersion.findFirst({
          where: { id: versionId, documentId: id, workspaceId: wid },
          select: { id: true, version: true, markdown: true },
        });
        if (!targetVersion) return { kind: "versionNotFound" as const, data: null };

        // 并发保护：对 Document 行加 FOR UPDATE 行锁
        await tx.$queryRaw`SELECT id FROM "documents" WHERE id = ${id} FOR UPDATE`;

        // 锁后重新读取 currentVersion，避免 READ COMMITTED 隔离级别下
        // 并发事务读到相同版本号导致版本号重复
        const docLocked = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { currentVersion: true },
        });
        if (!docLocked) return { kind: "docNotFound" as const, data: null };

        // 将目标版本的 markdown 写回文档草稿
        await tx.document.update({
          where: { id },
          data: { markdown: targetVersion.markdown },
        });

        // 创建回滚版本快照（版本号继续递增，不覆盖历史）
        const newVersion = docLocked.currentVersion + 1;
        // contentFull 不传（Json? 字段默认 SQL NULL）
        const created = await tx.documentVersion.create({
          data: {
            documentId: id,
            workspaceId: wid,
            version: newVersion,
            snapshotType: "full",
            contentDiff: null,
            markdown: targetVersion.markdown,
            message: `回滚到 v${targetVersion.version}`,
            source: "manual",
            authorId: ctx.payload.sub,
          },
          include: { author: { select: { id: true, name: true, email: true } } },
        });

        // 更新文档当前版本号
        await tx.document.update({
          where: { id },
          data: { currentVersion: newVersion },
        });

        return { kind: "ok" as const, data: created };
      },
      ctx.payload.sub,
    );

    if (result.kind === "docNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "versionNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    console.error("[POST document version restore] error:", error);
    return handlePrismaError(error, req);
  }
}