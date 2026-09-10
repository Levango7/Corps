import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * 标签 API · /api/v1/workspaces/{wid}/labels
 *
 * - GET：列出当前工作区所有标签
 * - POST：创建新标签（仅 owner/admin）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });

  try {
    const labels = await runWithWorkspace(
      wid,
      (tx) =>
        tx.label.findMany({
          where: { workspaceId: wid },
          orderBy: { createdAt: "asc" },
          take: 200,
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: labels });
  } catch (error) {
    console.error("[GET labels] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().max(50).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "onlyOwnerAdminCreateLabels") },
      {
        status: 403,
      },
    );
  }

  try {
    const validated = createLabelSchema.parse(await req.json());
    const label = await runWithWorkspace(
      wid,
      (tx) =>
        tx.label.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            color: validated.color ?? "var(--muted)",
          },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 201, data: label }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationError"), errors: error.errors },
        { status: 400 },
      );
    }
    // P2002：唯一约束冲突（同工作区标签名重复）
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "labelNameExists") },
        { status: 409 },
      );
    }
    console.error("[POST label] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const deleteLabelSchema = z.object({
  id: z.string().uuid(),
});

/**
 * DELETE /v1/workspaces/{wid}/labels — 删除标签
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
    const validated = deleteLabelSchema.parse(await req.json());

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.label.findFirst({
          where: { id: validated.id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const };
        await tx.label.delete({ where: { id: validated.id } });
        return { kind: "ok" as const };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "labelNotFound") },
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
    // P2003：外键约束冲突（标签仍被任务引用）
    if ((error as { code?: string }).code === "P2003") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "prismaForeignKeyViolation") },
        { status: 409 },
      );
    }
    console.error("[DELETE label] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const patchLabelSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50).optional(),
  color: z.string().max(50).optional(),
});

/**
 * PATCH /v1/workspaces/{wid}/labels — 编辑标签名称/颜色
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
    const validated = patchLabelSchema.parse(await req.json());
    // 至少需要一个可更新字段
    if (validated.name === undefined && validated.color === undefined) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed") },
        { status: 400 },
      );
    }

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.label.findFirst({
          where: { id: validated.id, workspaceId: wid },
          select: { id: true },
        });
        if (!existing) return { kind: "notFound" as const, data: null };

        const updated = await tx.label.update({
          where: { id: validated.id },
          data: {
            ...(validated.name !== undefined ? { name: validated.name } : {}),
            ...(validated.color !== undefined ? { color: validated.color } : {}),
          },
        });
        return { kind: "ok" as const, data: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "labelNotFound") },
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
    // P2002：唯一约束冲突（标签名重复）
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "labelNameExists") },
        { status: 409 },
      );
    }
    console.error("[PATCH label] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}
