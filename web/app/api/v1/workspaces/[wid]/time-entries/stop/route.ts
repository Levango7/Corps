import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

const stopSchema = z.object({
  teid: z.string().uuid(),
});

/**
 * POST /v1/workspaces/{wid}/time-entries/stop — 停止计时
 * 更新 TimeEntry：endTime=now, duration=Math.floor((endTime-startTime)/1000)
 * 返回更新后的 TimeEntry
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = stopSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.timeEntry.findFirst({
          where: { id: validated.teid, workspaceId: wid, userId: ctx.payload.sub },
          select: { id: true, startTime: true, endTime: true },
        });
        if (!existing) return { kind: "notFound" as const };
        if (existing.endTime) return { kind: "notRunning" as const };

        const now = new Date();
        const duration = Math.floor((now.getTime() - existing.startTime.getTime()) / 1000);

        const entry = await tx.timeEntry.update({
          where: { id: validated.teid },
          data: { endTime: now, duration },
          include: {
            user: { select: { id: true, name: true, email: true } },
            task: { select: { id: true, title: true } },
          },
        });
        return { kind: "ok" as const, entry };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "timeEntryNotFound"), data: null },
        { status: 404 },
      );
    }
    if (result.kind === "notRunning") {
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "timerNotRunning"), data: null },
        { status: 409 },
      );
    }

    return NextResponse.json({ code: 200, data: result.entry });
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
    console.error("[POST time-entry/stop] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
