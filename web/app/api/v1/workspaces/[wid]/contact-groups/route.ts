import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 联系人分组 API · /api/v1/workspaces/{wid}/contact-groups
 *
 * - GET：列出分组（include _count contacts）
 * - POST：创建分组（zod 校验 name）
 * - PATCH：更新分组名称（通过 ?gid= 查询参数或 body 中的 id）
 * - DELETE：删除分组（通过 ?gid= 查询参数，联系人 groupId 设为 null）
 */

/**
 * GET /v1/workspaces/{wid}/contact-groups — 分组列表
 * 返回按 name 正序，每组带 _count.contacts
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const groups = await runWithWorkspace(
      wid,
      (tx) =>
        tx.contactGroup.findMany({
          where: { workspaceId: wid },
          include: { _count: { select: { contacts: true } } },
          orderBy: [{ name: "asc" }],
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: groups });
  } catch (error) {
    console.error("[GET contact-groups] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
});

/** POST /v1/workspaces/{wid}/contact-groups — 创建分组 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const validated = createGroupSchema.parse(await req.json());

    const group = await runWithWorkspace(
      wid,
      (tx) =>
        tx.contactGroup.create({
          data: {
            workspaceId: wid,
            name: validated.name,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: group }, { status: 201 });
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
    // P2002：唯一约束冲突（同工作区分组名重复）
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "contactGroupNameExists"), data: null },
        { status: 409 },
      );
    }
    console.error("[POST contact-group] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

const patchGroupSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
});

/**
 * PATCH /v1/workspaces/{wid}/contact-groups — 更新分组名称
 * 分组 id 通过 ?gid= 查询参数或 body.id 提供
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const gidFromQuery = url.searchParams.get("gid") ?? undefined;
    const body = await req.json();
    const validated = patchGroupSchema.parse(body);
    const gid = gidFromQuery ?? validated.id;
    if (!gid) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.contactGroup.findFirst({
          where: { id: gid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const updated = await tx.contactGroup.update({
          where: { id: gid },
          data: { name: validated.name },
        });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "contactGroupNotFound"), data: null },
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
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "contactGroupNameExists"), data: null },
        { status: 409 },
      );
    }
    console.error("[PATCH contact-group] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/contact-groups — 删除分组
 * 通过 ?gid= 查询参数指定分组；联系人 groupId 由 onDelete: SetNull 自动置空
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const gid = url.searchParams.get("gid");
    if (!gid) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), data: null },
        { status: 400 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.contactGroup.findFirst({
          where: { id: gid, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };

        // 删除分组：Contact.groupId onDelete: SetNull，联系人自动解绑
        await tx.contactGroup.delete({ where: { id: gid } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "contactGroupNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: gid, deleted: true } });
  } catch (error) {
    console.error("[DELETE contact-group] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}