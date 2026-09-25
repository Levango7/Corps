import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { livekitApiHost } from "@/lib/livekit-utils";
import { EgressClient } from "livekit-server-sdk";

/**
 * POST /v1/workspaces/{wid}/meetings/{mid}/recording/stop — 停止会议录制
 *
 * 前置条件：
 *  1. 会议存在且属于当前工作区
 *  2. recordingUrl 以 `egress:` 开头（录制已启动且未停止）
 *  3. 操作者为会议创建者或 admin/owner
 *
 * 实现：使用 livekit-server-sdk 的 EgressClient.stopEgress 停止录制，
 * 设置 recordingStoppedAt，并将 recordingUrl 标记为 `completed:<egressId>`。
 * 最终录制文件 URL 由 webhook egress_ended 事件回填。
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

  // LiveKit 服务端配置检查
  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    return NextResponse.json(
      {
        code: 501,
        message: apiMsg(req, "recordingNotEnabled"),
        data: null,
      },
      { status: 501 },
    );
  }

  try {
    // 事务内校验并解析 egressId
    const check = await runWithWorkspace(
      wid,
      async (tx) => {
        const meeting = await tx.meeting.findFirst({
          where: { id: mid, workspaceId: wid },
          select: { id: true, recordingUrl: true, createdBy: true },
        });
        if (!meeting) return { kind: "notFound" as const };

        // 权限：创建者或 admin/owner
        const isCreator = meeting.createdBy === ctx.payload.sub;
        const isAdmin = ctx.member.role === "owner" || ctx.member.role === "admin";
        if (!isCreator && !isAdmin) return { kind: "forbidden" as const };

        // 录制必须已启动（recordingUrl 以 egress: 开头）
        if (!meeting.recordingUrl || !meeting.recordingUrl.startsWith("egress:")) {
          return { kind: "notStarted" as const };
        }

        const egressId = meeting.recordingUrl.slice("egress:".length);
        return { kind: "ok" as const, egressId };
      },
      ctx.payload.sub,
    );

    if (check.kind === "notFound")
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
        { status: 404 },
      );
    if (check.kind === "forbidden")
      return NextResponse.json(
        { code: 403, message: apiMsg(req, "noPermission"), data: null },
        { status: 403 },
      );
    if (check.kind === "notStarted")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "recordingNotStarted"), data: null },
        { status: 409 },
      );

    // 事务外调用 LiveKit EgressClient 停止录制
    const egressClient = new EgressClient(livekitApiHost(livekitUrl), apiKey, apiSecret);
    await egressClient.stopEgress(check.egressId);

    // 更新 meeting：标记录制已停止，最终 URL 等 webhook 回填
    const updated = await runWithWorkspace(
      wid,
      async (tx) => {
        return await tx.meeting.update({
          where: { id: mid },
          data: {
            recordingUrl: `completed:${check.egressId}`,
            recordingStoppedAt: new Date(),
          },
          select: { id: true, recordingUrl: true, recordingStoppedAt: true },
        });
      },
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { recordingUrl: updated.recordingUrl },
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
