import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/** templateData 结构（与列表路由一致，用于 PATCH 校验） */
const templateDataSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().max(5000).optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      }),
    )
    .default([]),
  labels: z.array(z.string()).default([]),
  milestones: z.array(z.string()).default([]),
});

/**
 * GET /v1/workspaces/{wid}/project-templates/{tid} — 获取单个模板详情
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; tid: string }> },
) {
  const { wid, tid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const tpl = await runWithWorkspace(
      wid,
      (tx) =>
        tx.projectTemplate.findUnique({
          where: { id: tid },
          include: { creator: { select: { id: true, name: true, email: true } } },
        }),
      ctx.payload.sub,
    );
    if (!tpl || tpl.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "templateNotFound"), data: null },
        { status: 404 },
      );
    }
    return NextResponse.json({ code: 200, data: tpl });
  } catch (error) {
    console.error("[GET project-template] error:", error);
    return handlePrismaError(error, req);
  }
}

/**
 * PATCH /v1/workspaces/{wid}/project-templates/{tid} — 更新模板
 * Body: 部分字段 { name?, description?, category?, templateData?, isPublic? }
 */
const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  templateData: templateDataSchema.optional(),
  isPublic: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; tid: string }> },
) {
  const { wid, tid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = updateTemplateSchema.parse(body);

    // 先确认模板存在且属于当前工作区（RLS 已隔离，但 findUnique 按 id 查询需显式校验 workspaceId）
    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.projectTemplate.findUnique({ where: { id: tid }, select: { workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "templateNotFound"), data: null },
        { status: 404 },
      );
    }

    const updated = await runWithWorkspace(
      wid,
      (tx) =>
        tx.projectTemplate.update({
          where: { id: tid },
          data: {
            ...(validated.name !== undefined ? { name: validated.name } : {}),
            ...(validated.description !== undefined ? { description: validated.description } : {}),
            ...(validated.category !== undefined ? { category: validated.category } : {}),
            ...(validated.templateData !== undefined
              ? { templateData: validated.templateData as object }
              : {}),
            ...(validated.isPublic !== undefined ? { isPublic: validated.isPublic } : {}),
          },
          include: { creator: { select: { id: true, name: true, email: true } } },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: updated });
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
    console.error("[PATCH project-template] error:", error);
    return handlePrismaError(error, req);
  }
}

/**
 * DELETE /v1/workspaces/{wid}/project-templates/{tid} — 删除模板
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; tid: string }> },
) {
  const { wid, tid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    // 先校验归属，再删除
    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.projectTemplate.findUnique({ where: { id: tid }, select: { workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "templateNotFound"), data: null },
        { status: 404 },
      );
    }

    await runWithWorkspace(
      wid,
      (tx) => tx.projectTemplate.delete({ where: { id: tid } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: { id: tid } });
  } catch (error) {
    console.error("[DELETE project-template] error:", error);
    return handlePrismaError(error, req);
  }
}