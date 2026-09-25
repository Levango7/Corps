import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import type { Prisma } from "@prisma/client";

/**
 * GET /v1/workspaces/{wid}/meeting-minutes/{mid} — 会议纪要详情
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; mid: string }> },
) {
  const { wid, mid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const minutes = await runWithWorkspace(
      wid,
      (tx) =>
        tx.meetingMinutes.findFirst({
          where: { id: mid, workspaceId: wid },
          include: {
            creator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (!minutes)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "minutesNotFound"), data: null },
        { status: 404 },
      );

    return NextResponse.json({ code: 200, data: minutes });
  } catch (error) {
    console.error("[GET meeting-minutes detail] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * 参会人员 / 行动项 schema（与 collection 路由一致）
 */
const attendeeSchema = z.object({
  userId: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  role: z.string().max(50).optional(),
});

const actionItemSchema = z.object({
  title: z.string().min(1).max(200),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
  done: z.boolean().default(false),
});

/**
 * PATCH /v1/workspaces/{wid}/meeting-minutes/{mid} — 更新会议纪要
 * Body: { title?, content?, attendees?, actionItems? }
 * 仅创建者或 admin/owner 可修改
 */
const updateMinutesSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  attendees: z.array(attendeeSchema).optional(),
  actionItems: z.array(actionItemSchema).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; mid: string }> },
) {
  const { wid, mid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const body = await req.json();
    const validated = updateMinutesSchema.parse(body);

    // 先查存在性 + 权限校验（创建者或 admin/owner）
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.meetingMinutes.findFirst({
          where: { id: mid, workspaceId: wid },
          select: { id: true, createdBy: true },
        }),
      ctx.payload.sub,
    );
    if (!existing)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "minutesNotFound"), data: null },
        { status: 404 },
      );

    const isCreator = existing.createdBy === ctx.payload.sub;
    const isAdmin = ctx.member.role === "owner" || ctx.member.role === "admin";
    if (!isCreator && !isAdmin) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noPermission"), data: null },
        { status: 403 },
      );
    }

    // JSON 字段需用 Prisma.InputJsonValue 转换
    const data: Prisma.MeetingMinutesUpdateInput = {};
    if (validated.title !== undefined) data.title = validated.title;
    if (validated.content !== undefined) data.content = validated.content;
    if (validated.attendees !== undefined)
      data.attendees = validated.attendees as Prisma.InputJsonValue;
    if (validated.actionItems !== undefined)
      data.actionItems = validated.actionItems as Prisma.InputJsonValue;

    const minutes = await runWithWorkspace(
      wid,
      (tx) =>
        tx.meetingMinutes.update({
          where: { id: mid },
          data,
          include: {
            creator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: minutes });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationError"),
          errors: error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    // P2025: 记录不存在（并发删除场景）
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "minutesNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH meeting-minutes] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/meeting-minutes/{mid} — 删除会议纪要
 * 仅创建者或 admin/owner 可删除
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; mid: string }> },
) {
  const { wid, mid } = await params;
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
        tx.meetingMinutes.findFirst({
          where: { id: mid, workspaceId: wid },
          select: { id: true, createdBy: true },
        }),
      ctx.payload.sub,
    );
    if (!existing)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "minutesNotFound"), data: null },
        { status: 404 },
      );

    const isCreator = existing.createdBy === ctx.payload.sub;
    const isAdmin = ctx.member.role === "owner" || ctx.member.role === "admin";
    if (!isCreator && !isAdmin) {
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noPermission"), data: null },
        { status: 403 },
      );
    }

    await runWithWorkspace(
      wid,
      (tx) => tx.meetingMinutes.delete({ where: { id: mid } }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: null });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "minutesNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE meeting-minutes] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
