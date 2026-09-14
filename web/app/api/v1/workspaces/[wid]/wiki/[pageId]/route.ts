import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/wiki/{pageId} — 获取单个 Wiki 页面详情（含直接子页面）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; pageId: string }> },
) {
  const { wid, pageId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const page = await runWithWorkspace(wid, (tx) =>
      tx.wikiPage.findFirst({
        where: { id: pageId, workspaceId: wid },
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          parentId: true,
          createdBy: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
          children: {
            select: {
              id: true,
              title: true,
              slug: true,
              sortOrder: true,
              updatedAt: true,
            },
            orderBy: { sortOrder: "asc" },
          },
          creator: { select: { id: true, name: true, email: true } },
        },
      }),
    );

    if (!page) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "wikiPageNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: page });
  } catch (error) {
    console.error("[GET wiki page] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** PATCH /v1/workspaces/{wid}/wiki/{pageId} — 更新 Wiki 页面 */
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
  slug: z.string().min(1).max(200).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; pageId: string }> },
) {
  const { wid, pageId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = updateSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.wikiPage.findFirst({
          where: { id: pageId, workspaceId: wid },
          select: { id: true, slug: true },
        });
        if (!existing) return { kind: "notFound" as const };

        // slug 变更时校验唯一性
        if (validated.slug && validated.slug !== existing.slug) {
          const conflict = await tx.wikiPage.findFirst({
            where: { workspaceId: wid, slug: validated.slug, NOT: { id: pageId } },
            select: { id: true },
          });
          if (conflict) return { kind: "slugConflict" as const };
        }

        // parentId 变更时校验父页面存在 + 防止自引用
        if (validated.parentId !== undefined && validated.parentId !== null) {
          if (validated.parentId === pageId) {
            return { kind: "selfParent" as const };
          }
          const parent = await tx.wikiPage.findFirst({
            where: { id: validated.parentId!, workspaceId: wid },
            select: { id: true },
          });
          if (!parent) return { kind: "parentNotFound" as const };
        }

        const data: Prisma.WikiPageUpdateInput = {};
        if (validated.title !== undefined) data.title = validated.title;
        if (validated.content !== undefined) data.content = validated.content;
        if (validated.sortOrder !== undefined) data.sortOrder = validated.sortOrder;
        if (validated.slug !== undefined) data.slug = validated.slug;
        if (validated.parentId !== undefined) {
          data.parent = validated.parentId
            ? { connect: { id: validated.parentId } }
            : { disconnect: true };
        }

        const page = await tx.wikiPage.update({
          where: { id: pageId },
          data,
          select: {
            id: true,
            title: true,
            slug: true,
            content: true,
            parentId: true,
            createdBy: true,
            sortOrder: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return { kind: "ok" as const, page };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "wikiPageNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "slugConflict") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "wikiSlugConflict"), data: null },
        { status: 409 },
      );
    }
    if (result.kind === "selfParent") {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    if (result.kind === "parentNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "wikiPageNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: result.page });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }
    // P2025: 记录不存在（并发删除）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "wikiPageNotFound"), data: null },
        { status: 404 },
      );
    }
    // P2002: unique 约束冲突（slug 并发碰撞）
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "wikiSlugConflict"), data: null },
        { status: 409 },
      );
    }
    console.error("[PATCH wiki page] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/wiki/{pageId} — 删除 Wiki 页面
 * 子页面的 parentId 由 Prisma onDelete: SetNull 自动置为 null（变为根页面）
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; pageId: string }> },
) {
  const { wid, pageId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.wikiPage.findFirst({
          where: { id: pageId, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.wikiPage.delete({ where: { id: pageId } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "wikiPageNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: pageId, deleted: true } });
  } catch (error) {
    // P2025: 记录不存在（并发删除）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "wikiPageNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE wiki page] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}