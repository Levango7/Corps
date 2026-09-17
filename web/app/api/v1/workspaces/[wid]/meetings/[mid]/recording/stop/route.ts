import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * POST /v1/workspaces/{wid}/meetings/{mid}/recording/stop — 停止会议录制
 *
 * 前置条件：
 *  1. 会议存在且属于当前工作区
 *  2. recordingUrl 不为空且以 `pending:` 开头（录制已启动）
 *  3. 操作者为会议创建者或 admin/owner
 *
 * 实现：占位实现——将 recordingUrl 设为 `completed:${mid}` 标记录制已完成。
 * TODO（集成 LiveKit）：替换为 RecordingService.stopRecording(recordingId)，
 *   将返回的最终媒体文件 URL（S3/对象存储）写入 recordingUrl。
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
          select: { id: true, recordingUrl: true, createdBy: true },
        });
        if (!meeting) return { kind: "notFound" as const };

        // 权限：创建者或 admin/owner
        const isCreator = meeting.createdBy === ctx.payload.sub;
        const isAdmin =
          ctx.member.role === "owner" || ctx.member.role === "admin";
        if (!isCreator && !isAdmin) return { kind: "forbidden" as const };

        // 录制必须已启动（recordingUrl 非空且为 pending 状态）
        if (
          !meeting.recordingUrl ||
          !meeting.recordingUrl.startsWith("pending:")
        ) {
          return { kind: "notStarted" as const };
        }

        // 占位最终录制 URL：completed:<mid>
        // TODO(LiveKit): const finalUrl = await recordingService.stop(meeting.recordingUrl);
        const recordingUrl = `completed:${mid}`;

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
    if (result.kind === "notStarted")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "recordingNotStarted"), data: null },
        { status: 409 },
      );

    return NextResponse.json({
      code: 200,
      data: { recordingUrl: result.meeting.recordingUrl },
      message: apiMsg(req, "recordingStopped"),
    });
  } catch (error) {
    // P2025: 并发删除导致 update 目标不存在
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
        { status: 404 },
      );
    }
    console.error("[POST recording/stop] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}