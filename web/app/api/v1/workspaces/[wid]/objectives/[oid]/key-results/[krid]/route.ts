import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { computeProgress } from "@/lib/okr";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  targetValue: z.number().optional(),
  currentValue: z.number().optional(),
  unit: z.string().max(20).nullable().optional(),
  weight: z.number().min(0).optional(),
  ownerId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

/** PATCH /v1/workspaces/{wid}/objectives/{oid}/key-results/{krid} — 更新关键结果并重算父目标进度 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string; oid: string; krid: string }> }) {
  const { wid, oid, krid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = patchSchema.parse(body);

    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.keyResult.findUnique({ where: { id: krid }, select: { id: true, objectiveId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.objectiveId !== oid) {
      return NextResponse.json({ code: 404, message: apiMsg(req, "keyResultNotFound"), data: null }, { status: 404 });
    }

    const updated = await runWithWorkspace(
      wid,
      async (tx) => {
        const kr = await tx.keyResult.update({
          where: { id: krid },
          data: {
            ...validated,
            dueDate: validated.dueDate === null ? null : validated.dueDate ? new Date(validated.dueDate) : undefined,
          },
        });

        // 重算父目标进度
        const allKrs = await tx.keyResult.findMany({
          where: { objectiveId: oid },
          select: { currentValue: true, targetValue: true, weight: true },
        });
        await tx.objective.update({
          where: { id: oid },
          data: { progress: computeProgress(allKrs) },
        });

        return kr;
      },
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
    console.error("[PATCH key-result] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/objectives/{oid}/key-results/{krid} — 删除关键结果并重算父目标进度 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ wid: string; oid: string; krid: string }> }) {
  const { wid, oid, krid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const existing = await runWithWorkspace(
      wid,
      (tx) => tx.keyResult.findUnique({ where: { id: krid }, select: { id: true, objectiveId: true } }),
      ctx.payload.sub,
    );
    if (!existing || existing.objectiveId !== oid) {
      return NextResponse.json({ code: 404, message: apiMsg(req, "keyResultNotFound"), data: null }, { status: 404 });
    }

    await runWithWorkspace(
      wid,
      async (tx) => {
        await tx.keyResult.delete({ where: { id: krid } });

        // 重算父目标进度
        const allKrs = await tx.keyResult.findMany({
          where: { objectiveId: oid },
          select: { currentValue: true, targetValue: true, weight: true },
        });
        await tx.objective.update({
          where: { id: oid },
          data: { progress: computeProgress(allKrs) },
        });
      },
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    console.error("[DELETE key-result] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}