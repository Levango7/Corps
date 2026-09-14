import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/** 审批节点配置 schema */
const approvalNodeSchema = z.object({
  approverRole: z.string().optional(),
  approverUserId: z.string().optional(),
  name: z.string().min(1).max(200),
  order: z.number().int().min(0),
});

/** PATCH 更新模板 body 校验（所有字段可选） */
const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  nodes: z.array(approvalNodeSchema).min(1).optional(),
  active: z.boolean().optional(),
});

/**
 * GET /v1/workspaces/{wid}/approvals/templates/{tid} — 模板详情
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; tid: string }> },
) {
  const { wid, tid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const template = await runWithWorkspace(wid, (tx) =>
      tx.approvalTemplate.findUnique({ where: { id: tid } }),
    );

    if (!template || template.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalTemplateNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: template });
  } catch (error) {
    console.error("[GET approval-template] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * PATCH /v1/workspaces/{wid}/approvals/templates/{tid} — 更新模板
 * 仅 admin/owner 可操作。Body: { name?, description?, nodes?, active? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; tid: string }> },
) {
  const { wid, tid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  // 仅 admin/owner 可操作
  if (ctx.member.role !== "owner" && ctx.member.role !== "admin") {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "forbidden"), data: null },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    const validated = updateTemplateSchema.parse(body);

    // 先确认模板存在且属于当前工作区
    const existing = await runWithWorkspace(wid, (tx) =>
      tx.approvalTemplate.findUnique({ where: { id: tid } }),
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalTemplateNotFound"), data: null },
        { status: 404 },
      );
    }

    const updated = await runWithWorkspace(
      wid,
      (tx) =>
        tx.approvalTemplate.update({
          where: { id: tid },
          data: {
            ...(validated.name !== undefined ? { name: validated.name } : {}),
            ...(validated.description !== undefined ? { description: validated.description } : {}),
            ...(validated.nodes !== undefined ? { nodes: validated.nodes } : {}),
            ...(validated.active !== undefined ? { active: validated.active } : {}),
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[PATCH approval-template] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/approvals/templates/{tid} — 软删除模板
 * 仅 admin/owner 可操作。设 active=false（不物理删除，保留历史审批实例引用）
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; tid: string }> },
) {
  const { wid, tid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  // 仅 admin/owner 可操作
  if (ctx.member.role !== "owner" && ctx.member.role !== "admin") {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "forbidden"), data: null },
      { status: 403 },
    );
  }

  try {
    // 先确认模板存在且属于当前工作区
    const existing = await runWithWorkspace(wid, (tx) =>
      tx.approvalTemplate.findUnique({ where: { id: tid } }),
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalTemplateNotFound"), data: null },
        { status: 404 },
      );
    }

    await runWithWorkspace(
      wid,
      (tx) => tx.approvalTemplate.update({ where: { id: tid }, data: { active: false } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE approval-template] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}