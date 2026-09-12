import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 文档评论 API · /api/v1/workspaces/{wid}/documents/{id}/comments
 * 设计文档 §2.4 — 行内批注（评论）
 *
 * - GET：列出文档评论（含讨论线程，按创建时间正序）
 * - POST：创建批注（body + anchorPath + anchorText）
 *
 * 锚点策略（设计文档 §2.4.1）：
 *  - anchorPath：ProseMirror 节点路径（如 "1.2.0"），定位到具体段落/文本
 *  - anchorText：锚点处文本片段（前 100 字符），用于锚点漂移时模糊匹配
 */

/** GET /v1/workspaces/{wid}/documents/{id}/comments — 评论列表（含讨论线程） */
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

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文档存在且属于本工作区（防跨租户读取）
        const doc = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true },
        });
        if (!doc) return null;

        // 查询所有评论（含作者/解决者），按创建时间正序
        // 讨论线程通过 parentId 自关联组织，前端按 parentId 分组渲染
        const comments = await tx.documentComment.findMany({
          where: { documentId: id, workspaceId: wid },
          include: {
            author: { select: { id: true, name: true, email: true, image: true } },
            resolver: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
          // 上限保护：单文档评论数不会很多，取 200 兜底
          take: 200,
        });
        return comments;
      },
      ctx.payload.sub,
    );

    if (result === null) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: { items: result, total: result.length } });
  } catch (error) {
    console.error("[GET document comments] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createCommentSchema = z.object({
  /** 批注锚点：ProseMirror 节点路径（如 "1.2.0"） */
  anchorPath: z.string().min(1).max(100),
  /** 批注锚点文本片段（用于锚点失效时模糊匹配） */
  anchorText: z.string().min(1),
  /** 批注内容（Markdown） */
  body: z.string().min(1).max(10000),
  /** @提及的用户 ID 列表 */
  mentions: z.array(z.string().uuid()).optional(),
  /** 父评论 ID（回复时传入，组成讨论线程） */
  parentId: z.string().uuid().optional(),
});

/** POST /v1/workspaces/{wid}/documents/{id}/comments — 创建批注
 *  权限：工作区成员均可创建评论（documents 模块 create 权限）
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
    const validated = createCommentSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验文档存在且属于本工作区（防跨租户写入）
        const doc = await tx.document.findFirst({
          where: { id, workspaceId: wid },
          select: { id: true, title: true },
        });
        if (!doc) return { kind: "docNotFound" as const, data: null };

        // 若指定 parentId，校验父评论存在且属于同一文档
        if (validated.parentId) {
          const parent = await tx.documentComment.findFirst({
            where: { id: validated.parentId, documentId: id, workspaceId: wid },
            select: { id: true },
          });
          if (!parent) return { kind: "parentNotFound" as const, data: null };
        }

        // 过滤非本工作区成员的提及（防止向外部用户发送通知）
        const mentions = validated.mentions ?? [];
        const validMentions: string[] = [];
        if (mentions.length > 0) {
          const members = await tx.member.findMany({
            where: { workspaceId: wid, userId: { in: mentions } },
            select: { userId: true },
          });
          const memberSet = new Set(members.map((m) => m.userId));
          for (const uid of mentions) {
            if (memberSet.has(uid)) validMentions.push(uid);
          }
        }

        const created = await tx.documentComment.create({
          data: {
            documentId: id,
            workspaceId: wid,
            anchorPath: validated.anchorPath,
            anchorText: validated.anchorText,
            body: validated.body,
            mentions: validMentions,
            parentId: validated.parentId ?? null,
            authorId: ctx.payload.sub,
          },
          include: {
            author: { select: { id: true, name: true, email: true, image: true } },
            resolver: { select: { id: true, name: true } },
          },
        });

        // 批量创建 mention 通知（排除评论作者自己）
        const notifyTargets = validMentions.filter(
          (uid) => uid && uid !== ctx.payload.sub,
        );
        if (notifyTargets.length > 0) {
          await tx.notification.createMany({
            data: notifyTargets.map((userId) => ({
              userId,
              workspaceId: wid,
              type: "mention" as const,
              entityId: id,
              entityTitle: doc.title,
            })),
          });
        }

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
    if (result.kind === "parentNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "commentNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 201, data: result.data }, { status: 201 });
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
    console.error("[POST document comment] error:", error);
    return handlePrismaError(error, req);
  }
}