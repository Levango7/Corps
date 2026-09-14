import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/forms/{fid} — 表单详情
 * include _count submissions
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string; fid: string }> }) {
  const { wid, fid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const form = await runWithWorkspace(
      wid,
      (tx) =>
        tx.form.findUnique({
          where: { id: fid },
          include: {
            _count: { select: { submissions: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (!form || form.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "formNotFound") }, { status: 404 });
    }

    return NextResponse.json({ code: 0, data: form });
  } catch (error) {
    console.error("[GET form] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const fieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "textarea", "number", "select", "radio", "checkbox", "date"]),
  label: z.string().min(1).max(200),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(200)).optional(),
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  fields: z.array(fieldSchema).min(1).optional(),
  active: z.boolean().optional(),
});

/** PATCH /v1/workspaces/{wid}/forms/{fid} — 更新表单 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string; fid: string }> }) {
  const { wid, fid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = patchSchema.parse(body);

    // 先确认存在且属于该工作区
    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.form.findUnique({ where: { id: fid }, select: { workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "formNotFound") }, { status: 404 });
    }

    const form = await runWithWorkspace(
      wid,
      (tx) =>
        tx.form.update({
          where: { id: fid },
          data: {
            ...(validated.title !== undefined ? { title: validated.title } : {}),
            ...(validated.description !== undefined ? { description: validated.description } : {}),
            ...(validated.fields !== undefined ? { fields: validated.fields as Prisma.InputJsonValue } : {}),
            ...(validated.active !== undefined ? { active: validated.active } : {}),
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: form });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[PATCH form] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

/** DELETE /v1/workspaces/{wid}/forms/{fid} — 删除表单 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ wid: string; fid: string }> }) {
  const { wid, fid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.form.findUnique({ where: { id: fid }, select: { workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.workspaceId !== wid) {
      return NextResponse.json({ code: 404, data: null, message: apiMsg(req, "formNotFound") }, { status: 404 });
    }

    await runWithWorkspace(
      wid,
      (tx) => tx.form.delete({ where: { id: fid } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: null });
  } catch (error) {
    console.error("[DELETE form] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}