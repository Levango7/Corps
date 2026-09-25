import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * POST /v1/workspaces/{wid}/recycle-bin/{id} — 恢复软删除条目
 *
 * 将 deletedAt 和 deletedBy 设为 null。先查 Task，找不到再查 Document。
 * 仅对已软删除（deletedAt NOT NULL）的条目生效，未删除的返回 400。
 *
 * 响应：{ code: 200, data: null, message: "已恢复" }
 */
export async function POST(
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

  try {
    // 先查 Task：必须是当前工作区且已软删除
    const task = await runWithWorkspace(
      wid,
      (tx) =>
        tx.task.findFirst({
          where: { id, workspaceId: wid, deletedAt: { not: null } },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    if (task) {
      await runWithWorkspace(
        wid,
        (tx) =>
          tx.task.update({
            where: { id },
            data: { deletedAt: null, deletedBy: null },
          }),
        ctx.payload.sub,
      );
      return NextResponse.json({ code: 200, data: null, message: apiMsg(req, "restored") });
    }

    // 再查 Document
    const doc = await runWithWorkspace(
      wid,
      (tx) =>
        tx.document.findFirst({
          where: { id, workspaceId: wid, deletedAt: { not: null } },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    if (doc) {
      await runWithWorkspace(
        wid,
        (tx) =>
          tx.document.update({
            where: { id },
            data: { deletedAt: null, deletedBy: null },
          }),
        ctx.payload.sub,
      );
      return NextResponse.json({ code: 200, data: null, message: apiMsg(req, "restored") });
    }

    // 既不是已删除的 Task 也不是已删除的 Document
    // 区分两种情况：条目不存在 / 条目存在但未被软删除
    const exists = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.task.findFirst({
            where: { id, workspaceId: wid },
            select: { deletedAt: true },
          }),
          tx.document.findFirst({
            where: { id, workspaceId: wid },
            select: { deletedAt: true },
          }),
        ]),
      ctx.payload.sub,
    );

    if (exists[0] || exists[1]) {
      // 存在但未软删除
      return NextResponse.json(
        { code: 400, data: null, message: apiMsg(req, "notDeleted") },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 404, data: null, message: apiMsg(req, "itemNotFound") },
      { status: 404 },
    );
  } catch (error) {
    console.error("[POST recycle-bin/{id}] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/recycle-bin/{id} — 永久删除
 *
 * 真正从数据库删除（prisma.task.delete / prisma.document.delete）。
 * 先查 Task，找不到再查 Document。仅对已软删除的条目生效。
 *
 * 响应：{ code: 200, data: null, message: "已永久删除" }
 */
export async function DELETE(
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

  try {
    // 先查 Task：必须是当前工作区且已软删除
    const task = await runWithWorkspace(
      wid,
      (tx) =>
        tx.task.findFirst({
          where: { id, workspaceId: wid, deletedAt: { not: null } },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    if (task) {
      await runWithWorkspace(wid, (tx) => tx.task.delete({ where: { id } }), ctx.payload.sub);
      return NextResponse.json({
        code: 200,
        data: null,
        message: apiMsg(req, "permanentlyDeleted"),
      });
    }

    // 再查 Document
    const doc = await runWithWorkspace(
      wid,
      (tx) =>
        tx.document.findFirst({
          where: { id, workspaceId: wid, deletedAt: { not: null } },
          select: { id: true },
        }),
      ctx.payload.sub,
    );

    if (doc) {
      await runWithWorkspace(wid, (tx) => tx.document.delete({ where: { id } }), ctx.payload.sub);
      return NextResponse.json({
        code: 200,
        data: null,
        message: apiMsg(req, "permanentlyDeleted"),
      });
    }

    // 既不是已删除的 Task 也不是已删除的 Document
    const exists = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.task.findFirst({
            where: { id, workspaceId: wid },
            select: { deletedAt: true },
          }),
          tx.document.findFirst({
            where: { id, workspaceId: wid },
            select: { deletedAt: true },
          }),
        ]),
      ctx.payload.sub,
    );

    if (exists[0] || exists[1]) {
      return NextResponse.json(
        { code: 400, data: null, message: apiMsg(req, "notDeleted") },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { code: 404, data: null, message: apiMsg(req, "itemNotFound") },
      { status: 404 },
    );
  } catch (error) {
    console.error("[DELETE recycle-bin/{id}] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
