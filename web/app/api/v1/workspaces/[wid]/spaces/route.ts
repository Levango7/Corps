import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 知识库空间 API · /api/v1/workspaces/{wid}/spaces
 * 设计文档 §2.2 — Workspace → Space → Folder → Document 层级
 *
 * - GET：列出工作区所有空间（按 sortOrder 排序）
 * - POST：创建空间（仅 owner/admin）
 */

/** GET /v1/workspaces/{wid}/spaces — 列出工作区所有空间 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const spaces = await runWithWorkspace(
      wid,
      (tx) =>
        tx.space.findMany({
          where: { workspaceId: wid },
          orderBy: { sortOrder: "asc" },
          // 上限保护：单工作区空间数量不会很多，取 200 兜底
          take: 200,
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: { items: spaces, total: spaces.length } });
  } catch (error) {
    console.error("[GET spaces] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createSpaceSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(50).optional(),
  color: z.string().max(50).optional(),
  sortOrder: z.number().optional(),
});

/** POST /v1/workspaces/{wid}/spaces — 创建空间（仅 owner/admin） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  // 权限：仅 owner/admin 可创建空间（复用标签创建权限语义）
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "onlyOwnerAdminCreateLabels"), data: null },
      { status: 403 },
    );
  }

  try {
    const validated = createSpaceSchema.parse(await req.json());

    const space = await runWithWorkspace(
      wid,
      (tx) =>
        tx.space.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            icon: validated.icon ?? "book",
            color: validated.color ?? "var(--accent)",
            sortOrder: validated.sortOrder ?? 0,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: space }, { status: 201 });
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
    console.error("[POST space] error:", error);
    return handlePrismaError(error, req);
  }
}

const updateSpaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(50).optional(),
  color: z.string().max(50).optional(),
  sortOrder: z.number().optional(),
});

/** PATCH /v1/workspaces/{wid}/spaces — 更新空间（名称/图标/颜色/排序）
 *  Body: { id, name?, icon?, color?, sortOrder? }
 *  权限：仅 owner/admin
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    const idSchema = z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      icon: z.string().max(50).optional(),
      color: z.string().max(50).optional(),
      sortOrder: z.number().optional(),
    });
    const validated = idSchema.parse(body);
    // 至少需要一个可更新字段
    if (
      validated.name === undefined &&
      validated.icon === undefined &&
      validated.color === undefined &&
      validated.sortOrder === undefined
    ) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.space.findFirst({
          where: { id: validated.id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const data: {
          name?: string;
          icon?: string;
          color?: string;
          sortOrder?: number;
        } = {};
        if (validated.name !== undefined) data.name = validated.name;
        if (validated.icon !== undefined) data.icon = validated.icon;
        if (validated.color !== undefined) data.color = validated.color;
        if (validated.sortOrder !== undefined) data.sortOrder = validated.sortOrder;

        const updated = await tx.space.update({ where: { id: validated.id }, data });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
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
    console.error("[PATCH space] error:", error);
    return handlePrismaError(error, req);
  }
}

const deleteSpaceSchema = z.object({
  id: z.string().uuid(),
});

/** DELETE /v1/workspaces/{wid}/spaces — 删除空间
 *  Body: { id }
 *  权限：仅 owner/admin
 *  语义：空间删除后，其下文档的 spaceId/folderId 被 SetNull 置空，归入"未分类"
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission"), data: null },
      { status: 403 },
    );
  }

  try {
    const validated = deleteSpaceSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.space.findFirst({
          where: { id: validated.id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        // 空间删除：Folder 级联删除，Document.spaceId/folderId 被 SetNull 置空
        await tx.space.delete({ where: { id: validated.id } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: validated.id, deleted: true } });
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
    console.error("[DELETE space] error:", error);
    return handlePrismaError(error, req);
  }
}