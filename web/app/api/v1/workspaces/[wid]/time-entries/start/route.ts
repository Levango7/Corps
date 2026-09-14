import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

const startSchema = z.object({
  taskId: z.string().uuid().optional(),
  description: z.string().optional(),
  billable: z.boolean().optional(),
  hourlyRate: z.number().nonnegative().optional(),
});

/**
 * POST /v1/workspaces/{wid}/time-entries/start — 开始计时
 * 创建 TimeEntry：startTime=now, endTime=null, duration=null
 * 若当前用户已有未停止的计时（endTime=null），返回 409
 * 返回创建的 TimeEntry
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const validated = startSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // 检查是否已有正在进行的计时
        const running = await tx.timeEntry.findFirst({
          where: { workspaceId: wid, userId: ctx.payload.sub, endTime: null },
          select: { id: true },
        });
        if (running) return { kind: "alreadyRunning" as const };

        const now = new Date();
        const entry = await tx.timeEntry.create({
          data: {
            workspaceId: wid,
            userId: ctx.payload.sub,
            taskId: validated.taskId,
            startTime: now,
            endTime: null,
            duration: null,
            description: validated.description,
            billable: validated.billable ?? false,
            hourlyRate: validated.hourlyRate,
          },
          include: {
            user: { select: { id: true, name: true, email: true } },
            task: { select: { id: true, title: true } },
          },
        });
        return { kind: "ok" as const, entry };
      },
      ctx.payload.sub,
    );

    if (result.kind === "alreadyRunning") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "timerAlreadyRunning"), data: null },
        { status: 409 },
      );
    }

    return NextResponse.json({ code: 201, data: result.entry }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST time-entry/start] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}