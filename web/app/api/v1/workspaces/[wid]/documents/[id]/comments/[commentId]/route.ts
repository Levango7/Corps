import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 文档评论详情 API · /api/v1/workspaces/{wid}/documents/{id}/comments/{commentId}
 * 设计文档 §2.4.2
 *
 * - PATCH：编辑批注内容 / 解决/重开批注
 * - DELETE：删除批注（作者本人或 owner/admin）
 */

const patchCommentSchema = z.object({
  /** 编辑批注内容（可选） */
  body: z.string().min(1).max(10000).optional(),
  /** 解决批注（true=解决，false=重新打开，不传=不改变解决状态） */
  resolved: z.boolean().optional(),
});

/**
 * PATCH /v1/workspaces/{wid}/documents/{id}/comments/{commentId} — 编辑/解决/重开批注
 * 权限：
 *  - 编辑 body：评论作者本人或 owner/admin
 *  - 解决/重开：工作区成员均可（documents 模块 update 权限）
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; commentId: string }> },
) {
  const { wid, id, commentId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const validated = patchCommentSchema.parse(await req.json());
    // 至少需要一个可操作字段
    if (validated.body === undefined && validated.resolved === undefined) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验评论存在且属于本文档/工作区
        const comment = await tx.documentComment.findFirst({
          where: { id: commentId, documentId: id, workspaceId: wid },
          select: { id: true, authorId: true, resolved: true },
        });
        if (!comment) return { kind: "notFound" as const, data: null };

        // 编辑 body 的权限：评论作者本人或 owner/admin
        if (validated.body !== undefined) {
          const isAuthor = comment.authorId === ctx.payload.sub;
          const isAdmin = ["owner", "admin"].includes(ctx.member.role);
          if (!isAuthor && !isAdmin) return { kind: "forbidden" as const, data: null };
        }

        // 构造更新数据
        const data: {
          body?: string;
          resolved?: boolean;
          resolvedBy?: string | null;
          resolvedAt?: Date | null;
        } = {};
        if (validated.body !== undefined) data.body = validated.body;
        if (validated.resolved !== undefined) {
          // 只有状态变化时才更新解决信息
          if (validated.resolved && !comment.resolved) {
            data.resolved = true;
            data.resolvedBy = ctx.payload.sub;
            data.resolvedAt = new Date();
          } else if (!validated.resolved && comment.resolved) {
            data.resolved = false;
            data.resolvedBy = null;
            data.resolvedAt = null;
          }
        }

        // 如果没有实际变化（如重复解决），直接返回当前评论
        if (Object.keys(data).length === 0) {
          const current = await tx.documentComment.findFirst({
            where: { id: commentId },
            include: {
              author: { select: { id: true, name: true, email: true, image: true } },
              resolver: { select: { id: true, name: true } },
            },
          });
          return { kind: "ok" as const, data: current };
        }

        const updated = await tx.documentComment.update({
          where: { id: commentId },
          data,
          include: {
            author: { select: { id: true, name: true, email: true, image: true } },
            resolver: { select: { id: true, name: true } },
          },
        });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "commentNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "forbidden") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noPermission"), data: null },
        { status: 403 },
      );
    }
    return NextResponse.json({ code: 200, data: result.data });
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
    console.error("[PATCH document comment] error:", error);
    return handlePrismaError(error, req);
  }
}

/**
 * DELETE /v1/workspaces/{wid}/documents/{id}/comments/{commentId} — 删除批注
 * 权限：评论作者本人或工作区 owner/admin
 * 语义：删除批注时，其回复（子评论）级联删除
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; commentId: string }> },
) {
  const { wid, id, commentId } = await params;
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
        // 校验评论存在且属于本文档/工作区（防跨租户删除）
        const comment = await tx.documentComment.findFirst({
          where: { id: commentId, documentId: id, workspaceId: wid },
          select: { id: true, authorId: true },
        });
        if (!comment) return { kind: "notFound" as const };

        // 权限：评论作者本人或 owner/admin
        const isAuthor = comment.authorId === ctx.payload.sub;
        const isAdmin = ["owner", "admin"].includes(ctx.member.role);
        if (!isAuthor && !isAdmin) return { kind: "forbidden" as const };

        // 删除批注：回复（子评论）通过 onDelete: Cascade 自动删除
        await tx.documentComment.delete({ where: { id: commentId } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "commentNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "forbidden") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noPermission"), data: null },
        { status: 403 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: commentId, deleted: true } });
  } catch (error) {
    console.error("[DELETE document comment] error:", error);
    return handlePrismaError(error, req);
  }
}