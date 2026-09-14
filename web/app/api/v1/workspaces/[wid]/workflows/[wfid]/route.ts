import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/workflows/{wfid} — 工作流详情
 * include executions（最近 10 条）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string; wfid: string }> }) {
  const { wid, wfid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const wf = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workflow.findUnique({
          where: { id: wfid },
          include: {
            executions: {
              orderBy: [{ createdAt: "desc" }],
              take: 10,
            },
          },
        }),
      ctx.payload.sub,
    );

    if (!wf || wf.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "workflowNotFound") }, { status: 404 });
    }

    return NextResponse.json({ code: 0, data: wf });
  } catch (error) {
    console.error("[GET workflow] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  trigger: z.record(z.unknown()).optional(),
  actions: z.array(z.record(z.unknown())).min(1).optional(),
  active: z.boolean().optional(),
});

/** PATCH /v1/workspaces/{wid}/workflows/{wfid} — 更新工作流 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string; wfid: string }> }) {
  const { wid, wfid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = patchSchema.parse(body);

    // 先确认存在且属于该工作区
    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.workflow.findUnique({ where: { id: wfid }, select: { workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "workflowNotFound") }, { status: 404 });
    }

    const wf = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workflow.update({
          where: { id: wfid },
          data: {
            ...(validated.name !== undefined ? { name: validated.name } : {}),
            ...(validated.description !== undefined ? { description: validated.description } : {}),
            ...(validated.trigger !== undefined ? { trigger: validated.trigger as Prisma.InputJsonValue } : {}),
            ...(validated.actions !== undefined ? { actions: validated.actions as Prisma.InputJsonValue } : {}),
            ...(validated.active !== undefined ? { active: validated.active } : {}),
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: wf });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[PATCH workflow] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

/** DELETE /v1/workspaces/{wid}/workflows/{wfid} — 删除工作流 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ wid: string; wfid: string }> }) {
  const { wid, wfid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.workflow.findUnique({ where: { id: wfid }, select: { workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "workflowNotFound") }, { status: 404 });
    }

    await runWithWorkspace(
      wid,
      (tx) => tx.workflow.delete({ where: { id: wfid } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: null });
  } catch (error) {
    console.error("[DELETE workflow] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}