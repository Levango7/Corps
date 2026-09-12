import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 文件夹 API · /api/v1/workspaces/{wid}/spaces/{spaceId}/folders
 * 设计文档 §2.2 — Space → Folder → Document 层级，Folder 可嵌套（最多 5 层）
 *
 * - GET：列出空间所有文件夹（按 sortOrder 排序）
 * - POST：创建文件夹（仅 owner/admin，限深 5 层）
 */

/** 文件夹最大嵌套深度（设计文档 §2.2.1：最多 5 层） */
const MAX_FOLDER_DEPTH = 5;

/** GET /v1/workspaces/{wid}/spaces/{spaceId}/folders — 列出空间所有文件夹 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; spaceId: string }> },
) {
  const { wid, spaceId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const folders = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验空间确实属于本工作区（防跨租户读取）
        const space = await tx.space.findFirst({
          where: { id: spaceId, workspaceId: wid },
          select: { id: true },
        });
        if (!space) return null;

        return tx.folder.findMany({
          where: { spaceId, workspaceId: wid },
          orderBy: { sortOrder: "asc" },
          // 上限保护：文件夹数量不会很多，取 200 兜底
          take: 200,
        });
      },
      ctx.payload.sub,
    );

    if (folders === null) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: { items: folders, total: folders.length } });
  } catch (error) {
    console.error("[GET folders] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createFolderSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().uuid().nullable().optional(),
  icon: z.string().max(50).optional(),
  sortOrder: z.number().optional(),
});

/** POST /v1/workspaces/{wid}/spaces/{spaceId}/folders — 创建文件夹（仅 owner/admin）
 *  限深：最多 5 层嵌套（parentId=null 为根层级 depth=1）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; spaceId: string }> },
) {
  const { wid, spaceId } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "onlyOwnerAdminCreateLabels"), data: null },
      { status: 403 },
    );
  }

  try {
    const validated = createFolderSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 校验空间确实属于本工作区
        const space = await tx.space.findFirst({
          where: { id: spaceId, workspaceId: wid },
          select: { id: true },
        });
        if (!space) return { kind: "spaceNotFound" as const, data: null };

        // 限深校验：若指定 parentId，递归计算父文件夹深度
        if (validated.parentId) {
          const parentDepth = await computeFolderDepth(tx, validated.parentId, wid);
          if (parentDepth === null) {
            return { kind: "parentNotFound" as const, data: null };
          }
          if (parentDepth >= MAX_FOLDER_DEPTH) {
            return { kind: "depthExceeded" as const, data: null };
          }
          // 校验父文件夹属于同一空间
          const parent = await tx.folder.findFirst({
            where: { id: validated.parentId, spaceId, workspaceId: wid },
            select: { id: true },
          });
          if (!parent) return { kind: "parentNotFound" as const, data: null };
        }

        const folder = await tx.folder.create({
          data: {
            workspaceId: wid,
            spaceId,
            parentId: validated.parentId ?? null,
            name: validated.name,
            icon: validated.icon ?? "folder",
            sortOrder: validated.sortOrder ?? 0,
          },
        });
        return { kind: "ok" as const, data: folder };
      },
      ctx.payload.sub,
    );

    if (result.kind === "spaceNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "parentNotFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "prismaRecordNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "depthExceeded") {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
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
    console.error("[POST folder] error:", error);
    return handlePrismaError(error, req);
  }
}

/**
 * 计算文件夹的嵌套深度（根层级 = 1）。
 * 向上遍历 parentId 链，遇到 null 返回当前深度；超过 MAX_FOLDER_DEPTH+5 兜底防死循环。
 */
async function computeFolderDepth(
  tx: Prisma.TransactionClient,
  folderId: string,
  wid: string,
): Promise<number | null> {
  let depth = 1;
  let currentId: string | null = folderId;
  const guard = MAX_FOLDER_DEPTH + 5;
  while (currentId !== null && depth <= guard) {
    const currentFolderId: string = currentId;
    const folder = await tx.folder.findFirst({
      where: { id: currentFolderId, workspaceId: wid },
      select: { parentId: true },
    });
    if (!folder) return null;
    if (folder.parentId === null) return depth;
    currentId = folder.parentId;
    depth++;
  }
  return depth;
}

const updateFolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(50).optional(),
  sortOrder: z.number().optional(),
  expanded: z.boolean().optional(),
});

/** PATCH /v1/workspaces/{wid}/spaces/{spaceId}/folders — 更新文件夹
 *  Body: { id, name?, icon?, sortOrder?, expanded? }
 *  权限：仅 owner/admin
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; spaceId: string }> },
) {
  const { wid, spaceId } = await params;
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
    const validated = updateFolderSchema.parse(await req.json());
    if (
      validated.name === undefined &&
      validated.icon === undefined &&
      validated.sortOrder === undefined &&
      validated.expanded === undefined
    ) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.folder.findFirst({
          where: { id: validated.id, spaceId, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const data: {
          name?: string;
          icon?: string;
          sortOrder?: number;
          expanded?: boolean;
        } = {};
        if (validated.name !== undefined) data.name = validated.name;
        if (validated.icon !== undefined) data.icon = validated.icon;
        if (validated.sortOrder !== undefined) data.sortOrder = validated.sortOrder;
        if (validated.expanded !== undefined) data.expanded = validated.expanded;

        const updated = await tx.folder.update({ where: { id: validated.id }, data });
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
    console.error("[PATCH folder] error:", error);
    return handlePrismaError(error, req);
  }
}

const deleteFolderSchema = z.object({
  id: z.string().uuid(),
});

/** DELETE /v1/workspaces/{wid}/spaces/{spaceId}/folders — 删除文件夹
 *  Body: { id }
 *  权限：仅 owner/admin
 *  语义：子文件夹级联删除，其下文档的 folderId 被 SetNull 置空（归入空间根目录）
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; spaceId: string }> },
) {
  const { wid, spaceId } = await params;
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
    const validated = deleteFolderSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.folder.findFirst({
          where: { id: validated.id, spaceId, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        // 文件夹删除：子文件夹级联删除，Document.folderId 被 SetNull 置空
        await tx.folder.delete({ where: { id: validated.id } });
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
    console.error("[DELETE folder] error:", error);
    return handlePrismaError(error, req);
  }
}