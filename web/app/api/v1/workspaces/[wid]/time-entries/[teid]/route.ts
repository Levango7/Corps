import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { checkPermission } from "@/lib/permissions";

const updateSchema = z.object({
  endTime: z.string().datetime().nullable().optional(),
  duration: z.number().int().min(0).nullable().optional(),
  description: z.string().nullable().optional(),
  billable: z.boolean().optional(),
  hourlyRate: z.number().nonnegative().nullable().optional(),
});

/** GET /v1/workspaces/{wid}/time-entries/{teid} — 获取单条工时记录 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; teid: string }> },
) {
  const { wid, teid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const entry = await runWithWorkspace(
      wid,
      (tx) =>
        tx.timeEntry.findFirst({
          where: { id: teid, workspaceId: wid },
          include: {
            user: { select: { id: true, name: true, email: true } },
            task: { select: { id: true, title: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (!entry)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "timeEntryNotFound"), data: null },
        { status: 404 },
      );

    return NextResponse.json({ code: 200, data: entry });
  } catch (error) {
    console.error("[GET time-entry] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** PATCH /v1/workspaces/{wid}/time-entries/{teid} — 更新工时记录 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; teid: string }> },
) {
  const { wid, teid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = updateSchema.parse(body);

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const existing = await tx.timeEntry.findFirst({
          where: { id: teid, workspaceId: wid },
          select: { id: true, userId: true },
        });
        if (!existing) return { kind: "notFound" as const };

        // 横向越权防护：仅允许记录所有者修改，owner/admin 可修改任意记录
        const isOwner = existing.userId === ctx.payload.sub;
        const canManageOthers = await checkPermission(ctx, "timetrack", "update");
        if (!isOwner && !canManageOthers) {
          return { kind: "forbidden" as const };
        }

        const entry = await tx.timeEntry.update({
          where: { id: teid },
          data: {
            ...(validated.endTime !== undefined
              ? { endTime: validated.endTime ? new Date(validated.endTime) : null }
              : {}),
            ...(validated.duration !== undefined ? { duration: validated.duration } : {}),
            ...(validated.description !== undefined ? { description: validated.description } : {}),
            ...(validated.billable !== undefined ? { billable: validated.billable } : {}),
            ...(validated.hourlyRate !== undefined ? { hourlyRate: validated.hourlyRate } : {}),
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

    if (result.kind === "notFound") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "timeEntryNotFound"), data: null },
        { status: 404 },
      );
    }

    if (result.kind === "forbidden") {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "forbidden"), data: null },
        { status: 403 },
      );
    }

    return NextResponse.json({ code: 200, data: result.entry });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationError"), errors: error.errors, data: null },
        { status: 400 },
      );
    }
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "timeEntryNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH time-entry] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/** DELETE /v1/workspaces/{wid}/time-entries/{teid} — 删除工时记录 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; teid: string }> },
) {
  const { wid, teid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.timeEntry.findFirst({
          where: { id: teid, workspaceId: wid },
          select: { id: true, userId: true },
        }),
      ctx.payload.sub,
    );
    if (!existing) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "timeEntryNotFound"), data: null },
        { status: 404 },
      );
    }

    // 横向越权防护：仅允许记录所有者删除，owner/admin 可删除任意记录
    const isOwner = existing.userId === ctx.payload.sub;
    const canManageOthers = await checkPermission(ctx, "timetrack", "delete");
    if (!isOwner && !canManageOthers) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "forbidden"), data: null },
        { status: 403 },
      );
    }

    await runWithWorkspace(
      wid,
      (tx) => tx.timeEntry.delete({ where: { id: teid } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "timeEntryNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE time-entry] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
