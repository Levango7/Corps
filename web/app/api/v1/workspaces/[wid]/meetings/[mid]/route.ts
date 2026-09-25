import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/meetings/{mid} — 会议详情（含 participants 关联）
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
    const meeting = await runWithWorkspace(
      wid,
      (tx) =>
        tx.meeting.findFirst({
          where: { id: mid, workspaceId: wid },
          include: {
            creator: { select: { id: true, name: true, email: true } },
            participants: {
              select: {
                id: true,
                userId: true,
                joinedAt: true,
                leftAt: true,
                role: true,
                user: { select: { id: true, name: true, email: true, image: true } },
              },
              orderBy: [{ joinedAt: "asc" }],
            },
          },
        }),
      ctx.payload.sub,
    );

    if (!meeting)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
        { status: 404 },
      );

    return NextResponse.json({ code: 200, data: meeting });
  } catch (error) {
    console.error("[GET meeting] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * PATCH /v1/workspaces/{wid}/meetings/{mid} — 更新会议
 * 仅 host/创建者或 admin/owner 可修改
 */
const updateMeetingSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  maxParticipants: z.number().int().min(1).max(500).optional(),
  recordingEnabled: z.boolean().optional(),
  // L2 #28：status 枚举约束（含 cancelled）
  status: z.enum(["scheduled", "active", "ended", "cancelled"]).optional(),
  // L6 #32：重复规则
  recurringRule: z.string().max(255).nullable().optional(),
  // L8 #34：会议密码
  password: z.string().max(100).nullable().optional(),
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
    const validated = updateMeetingSchema.parse(body);

    // 先查会议存在性 + 权限校验（创建者或 admin/owner）
    const existing = await runWithWorkspace(
      wid,
      (tx) =>
        tx.meeting.findFirst({
          where: { id: mid, workspaceId: wid },
          select: { id: true, createdBy: true },
        }),
      ctx.payload.sub,
    );
    if (!existing)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
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

    // scheduledAt 需从 ISO 字符串转为 Date
    const { scheduledAt, ...restValidated } = validated;
    const meeting = await runWithWorkspace(
      wid,
      (tx) =>
        tx.meeting.update({
          where: { id: mid },
          data: {
            ...restValidated,
            ...(scheduledAt !== undefined
              ? { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }
              : {}),
          },
          include: {
            creator: { select: { id: true, name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: meeting });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    // P2025: 记录不存在（并发删除场景）
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[PATCH meeting] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

/**
 * DELETE /v1/workspaces/{wid}/meetings/{mid} — 结束会议
 * 设置 status="ended", endedAt=now
 * 仅 host/创建者或 admin/owner 可操作
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
        tx.meeting.findFirst({
          where: { id: mid, workspaceId: wid },
          select: { id: true, createdBy: true, status: true },
        }),
      ctx.payload.sub,
    );
    if (!existing)
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
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
      (tx) =>
        tx.meeting.update({
          where: { id: mid },
          data: {
            status: "ended",
            endedAt: new Date(),
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: null,
      message: apiMsg(req, "meetingEnded"),
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[DELETE meeting] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
