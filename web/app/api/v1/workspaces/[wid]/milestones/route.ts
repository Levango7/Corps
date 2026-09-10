import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 里程碑 API · /api/v1/workspaces/{wid}/milestones
 *
 * - GET：列出当前工作区所有里程碑（按创建时间正序）
 * - POST：创建新里程碑（仅 owner/admin）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });

  try {
    const milestones = await runWithWorkspace(
      wid,
      (tx) =>
        tx.milestone.findMany({
          where: { workspaceId: wid },
          orderBy: { createdAt: "asc" },
          take: 200,
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: milestones });
  } catch (error) {
    console.error("[GET milestones] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}


const createMilestoneSchema = z.object({
  name: z.string().min(1).max(100),
  dueDate: z.string().datetime().optional(),
  description: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "onlyOwnerAdminCreateMilestones") },
      {
        status: 403,
      },
    );
  }

  try {
    const validated = createMilestoneSchema.parse(await req.json());
    const milestone = await runWithWorkspace(
      wid,
      (tx) =>
        tx.milestone.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
            description: validated.description,
          },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 201, data: milestone }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationError"), errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST milestone] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const deleteMilestoneSchema = z.object({
  id: z.string().uuid(),
});

/**
 * DELETE /v1/workspaces/{wid}/milestones — 删除里程碑
 * 权限：仅 owner/admin
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission") },
      { status: 403 },
    );
  }

  try {
    const validated = deleteMilestoneSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.milestone.findFirst({
          where: { id: validated.id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.milestone.delete({ where: { id: validated.id } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "milestoneNotFound") },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: { id: validated.id, deleted: true } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationError"), errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[DELETE milestone] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const patchMilestoneSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  dueDate: z.string().datetime().optional(),
  description: z.string().max(2000).optional(),
});

/**
 * PATCH /v1/workspaces/{wid}/milestones — 编辑里程碑名称/截止日期/描述
 * 权限：仅 owner/admin
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "noPermission") },
      { status: 403 },
    );
  }

  try {
    const validated = patchMilestoneSchema.parse(await req.json());
    // 至少需要一个可更新字段
    if (
      validated.name === undefined &&
      validated.dueDate === undefined &&
      validated.description === undefined
    ) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed") },
        { status: 400 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.milestone.findFirst({
          where: { id: validated.id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const updated = await tx.milestone.update({
          where: { id: validated.id },
          data: {
            ...(validated.name !== undefined ? { name: validated.name } : {}),
            ...(validated.dueDate !== undefined
              ? { dueDate: validated.dueDate ? new Date(validated.dueDate) : null }
              : {}),
            ...(validated.description !== undefined ? { description: validated.description } : {}),
          },
        });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "milestoneNotFound") },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationError"), errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[PATCH milestone] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}
