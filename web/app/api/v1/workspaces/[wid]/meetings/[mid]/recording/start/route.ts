import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import {
  EgressClient,
  EncodedFileOutput,
  S3Upload,
  EncodedFileType,
} from "livekit-server-sdk";

/**
 * 将 LiveKit WebSocket 接入地址转换为 HTTP/HTTPS API 地址。
 * EgressClient 需要 HTTP host（如 http://host:7880），
 * 而 LIVEKIT_URL 通常是 ws:// 或 wss://。
 */
function livekitApiHost(wsUrl: string): string {
  if (wsUrl.startsWith("wss://")) return "https://" + wsUrl.slice(6);
  if (wsUrl.startsWith("ws://")) return "http://" + wsUrl.slice(5);
  return wsUrl; // 已是 http/https
}

/** 检查 S3 录制存储配置是否齐全。 */
function getS3Config(): {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
} | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const region = process.env.S3_REGION;
  if (!endpoint || !bucket || !accessKey || !secretKey || !region) return null;
  return { endpoint, bucket, accessKey, secretKey, region };
}

/**
 * POST /v1/workspaces/{wid}/meetings/{mid}/recording/start — 启动会议录制
 *
 * 前置条件：
 *  1. 会议存在且属于当前工作区
 *  2. 会议状态为 active（仅进行中的会议可录制）
 *  3. recordingEnabled === true（创建会议时已开启录制开关）
 *  4. 操作者为会议创建者或 admin/owner
 *  5. LiveKit + S3 存储配置就绪
 *
 * 实现：使用 livekit-server-sdk 的 EgressClient.startRoomCompositeEgress
 * 启动房间合成录制，将返回的 egressId 写入 recordingUrl（格式 `egress:<id>`），
 * 并设置 recordingStartedAt。最终录制文件 URL 由 webhook egress_ended 事件回填。
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

  // S3 录制存储配置检查——未配置时返回 501
  const s3 = getS3Config();
  if (!s3) {
    return NextResponse.json(
      {
        code: 501,
        message: apiMsg(req, "recordingNotEnabled"),
        data: null,
      },
      { status: 501 },
    );
  }

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
    // 事务内校验会议状态与权限，同时写入 "egress:pending" 占位标记（乐观锁）
    // 防止并发请求同时通过校验后各自启动 Egress（TOCTOU 竞态）
    const check = await runWithWorkspace(
      wid,
      async (tx) => {
        const meeting = await tx.meeting.findFirst({
          where: { id: mid, workspaceId: wid },
          select: {
            id: true,
            status: true,
            recordingEnabled: true,
            recordingUrl: true,
            roomName: true,
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

        // 录制已启动则拒绝重复启动
        if (meeting.recordingUrl?.startsWith("egress:")) {
          return { kind: "alreadyStarted" as const };
        }

        // 写入 "egress:pending" 占位标记——并发请求此时会看到 recordingUrl 已有值
        await tx.meeting.update({
          where: { id: mid },
          data: { recordingUrl: "egress:pending" },
        });

        return { kind: "ok" as const, roomName: meeting.roomName };
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
    if (check.kind === "notActive")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "meetingNotActive"), data: null },
        { status: 409 },
      );
    if (check.kind === "notEnabled")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "recordingNotEnabled"), data: null },
        { status: 409 },
      );
    if (check.kind === "alreadyStarted")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "recordingStarted"), data: null },
        { status: 409 },
      );

    // 事务外调用 LiveKit EgressClient（不在事务内做网络 IO）
    const egressClient = new EgressClient(
      livekitApiHost(livekitUrl),
      apiKey,
      apiSecret,
    );
    const filepath = `recordings/${mid}-${Date.now()}.mp4`;
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath,
      output: {
        case: "s3",
        value: new S3Upload({
          accessKey: s3.accessKey,
          secret: s3.secretKey,
          region: s3.region,
          endpoint: s3.endpoint,
          bucket: s3.bucket,
        }),
      },
    });
    const egressInfo = await egressClient.startRoomCompositeEgress(
      check.roomName,
      output,
    );

    // 原子抢占：仅当 recordingUrl 仍为 "egress:pending" 时才更新为真实 egressId
    // 若另一并发请求已抢先更新（recordingUrl 不再是 "egress:pending"），
    // 则当前请求竞争失败，需停止自己启动的 Egress 并返回 409
    const claim = await runWithWorkspace(
      wid,
      async (tx) => {
        const result = await tx.meeting.updateMany({
          where: { id: mid, recordingUrl: "egress:pending" },
          data: {
            recordingUrl: `egress:${egressInfo.egressId}`,
            recordingStartedAt: new Date(),
          },
        });
        return result.count > 0;
      },
      ctx.payload.sub,
    );

    if (!claim) {
      // 竞态失败：另一请求已抢先，停止当前 Egress 并返回 409
      try {
        await egressClient.stopEgress(egressInfo.egressId);
      } catch (stopError) {
        console.error("[POST recording/start] failed to stop losing egress:", stopError);
      }
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "recordingStarted"), data: null },
        { status: 409 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: { recordingId: egressInfo.egressId },
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
