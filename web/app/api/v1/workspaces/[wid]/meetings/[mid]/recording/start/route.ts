import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * POST /v1/workspaces/{wid}/meetings/{mid}/recording/start — 启动会议录制
 *
 * 前置条件：
 *  1. 会议存在且属于当前工作区
 *  2. 会议状态为 active（仅进行中的会议可录制）
 *  3. recordingEnabled === true（创建会议时已开启录制开关）
 *  4. 操作者为会议创建者或 admin/owner
 *
 * 实现：项目未集成 LiveKit RecordingService（需服务端 SDK + Egress 配置），
 * 此处为占位实现——将 recordingUrl 设为 `pending:${mid}` 标记录制进行中。
 * TODO（集成 LiveKit）：替换为 RecordingService.startRecording(roomName)，
 *   将返回的 recordingId 写入 recordingUrl，并在 stop 端点调用 stopRecording。
 *
 * 信封格式与现有会议端点一致：{ code, data, message }
 */
export async function POST(
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
    // 事务内一次性完成：校验 → 更新，避免 TOCTOU
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const meeting = await tx.meeting.findFirst({
          where: { id: mid, workspaceId: wid },
          select: {
            id: true,
            status: true,
            recordingEnabled: true,
            recordingUrl: true,
            createdBy: true,
          },
        });
        if (!meeting) return { kind: "notFound" as const };

        // 权限：创建者或 admin/owner
        const isCreator = meeting.createdBy === ctx.payload.sub;
        const isAdmin =
          ctx.member.role === "owner" || ctx.member.role === "admin";
        if (!isCreator && !isAdmin) return { kind: "forbidden" as const };

        // 仅进行中的会议可录制
        if (meeting.status !== "active") return { kind: "notActive" as const };

        // 必须在创建时开启录制开关
        if (!meeting.recordingEnabled) return { kind: "notEnabled" as const };

        // 占位录制 URL：pending:<mid> 表示录制进行中
        // TODO(LiveKit): const recId = await recordingService.start(meeting.roomName);
        const recordingUrl = `pending:${mid}`;

        const updated = await tx.meeting.update({
          where: { id: mid },
          data: { recordingUrl },
          select: { id: true, recordingUrl: true, status: true },
        });
        return { kind: "ok" as const, meeting: updated };
      },
      ctx.payload.sub,
    );

    if (result.kind === "notFound")
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
        { status: 404 },
      );
    if (result.kind === "forbidden")
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noPermission"), data: null },
        { status: 403 },
      );
    if (result.kind === "notActive")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "meetingNotActive"), data: null },
        { status: 409 },
      );
    if (result.kind === "notEnabled")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "recordingNotEnabled"), data: null },
        { status: 409 },
      );

    return NextResponse.json({
      code: 200,
      data: { recordingUrl: result.meeting.recordingUrl },
      message: apiMsg(req, "recordingStarted"),
    });
  } catch (error) {
    // P2025: 并发删除导致 update 目标不存在
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[POST recording/start] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}