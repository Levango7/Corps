import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { checkRateLimit } from "@/lib/rate-limit";
import { computeProgress } from "@/lib/okr";

/**
 * GET /v1/workspaces/{wid}/objectives/{oid}/key-results — 关键结果列表
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string; oid: string }> }) {
  const { wid, oid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  const limited = await checkRateLimit(req, "okr-key-results-list", { windowMs: 60_000, max: 60 });
  if (limited) return limited;

  try {
    const obj = await runWithWorkspace(
      wid,
      (tx) => tx.objective.findUnique({ where: { id: oid }, select: { id: true, workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!obj || obj.workspaceId !== wid) {
      return NextResponse.json({ code: 404, message: apiMsg(req, "objectiveNotFound"), data: null }, { status: 404 });
    }

    const keyResults = await runWithWorkspace(
      wid,
      (tx) =>
        tx.keyResult.findMany({
          where: { objectiveId: oid },
          orderBy: [{ createdAt: "asc" }],
          include: { owner: { select: { id: true, name: true, email: true } } },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: keyResults });
  } catch (error) {
    console.error("[GET key-results] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  targetValue: z.number(),
  currentValue: z.number().optional(),
  unit: z.string().max(20).optional(),
  weight: z.number().min(0).optional(),
  ownerId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
});

/** POST /v1/workspaces/{wid}/objectives/{oid}/key-results — 创建关键结果并重算父目标进度 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string; oid: string }> }) {
  const { wid, oid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  const limited = await checkRateLimit(req, "okr-key-result-create", { windowMs: 60_000, max: 30 });
  if (limited) return limited;

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    const obj = await runWithWorkspace(
      wid,
      (tx) => tx.objective.findUnique({ where: { id: oid }, select: { id: true, workspaceId: true } }),
      ctx.payload.sub,
    );
    if (!obj || obj.workspaceId !== wid) {
      return NextResponse.json({ code: 404, message: apiMsg(req, "objectiveNotFound"), data: null }, { status: 404 });
    }

    // 创建关键结果 + 重算父目标进度（同一事务内原子完成）
    const created = await runWithWorkspace(
      wid,
      async (tx) => {
        const kr = await tx.keyResult.create({
          data: {
            objectiveId: oid,
            title: validated.title,
            targetValue: validated.targetValue,
            currentValue: validated.currentValue ?? 0,
            unit: validated.unit,
            weight: validated.weight ?? 1,
            ownerId: validated.ownerId,
            dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
          },
        });

        // 重算进度
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

    return NextResponse.json({ code: 201, data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST key-result] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}