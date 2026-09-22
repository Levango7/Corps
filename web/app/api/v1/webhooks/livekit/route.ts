import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { WebhookReceiver, type WebhookEvent } from "livekit-server-sdk";

/**
 * POST /v1/webhooks/livekit — LiveKit Server webhook 端点
 *
 * LiveKit Server 在房间/参与者/egress 事件发生时回调此端点。
 * 使用 livekit-server-sdk 的 WebhookReceiver 验证签名并解析事件。
 *
 * 处理的事件：
 *  - room_started       → 会议状态改为 active
 *  - room_finished      → 会议状态改为 ended
 *  - participant_joined → upsert 参与者记录
 *  - participant_left   → 标记参与者离开（leftAt = now）
 *  - egress_ended       → 回填录制文件 URL（recordingUrl）
 *
 * 数据库操作通过 runWithAuthOp("webhook") 绕过 RLS（webhook 无用户上下文）。
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { code: 501, data: null, message: "LiveKit not configured" },
      { status: 501 },
    );
  }

  try {
    // 读取原始 body 字符串（WebhookReceiver 需要原始 body 做签名验证）
    const body = await req.text();
    // LiveKit webhook 签名放在 Authorize 头
    const authHeader = req.headers.get("authorize") ?? "";

    const receiver = new WebhookReceiver(apiKey, apiSecret);
    const event: WebhookEvent = await receiver.receive(body, authHeader);

    // handleEvent 内部错误应返回 500，不应与签名验证失败混淆
    try {
      await handleEvent(event);
    } catch (error) {
      console.error("[webhook livekit] handleEvent error:", error);
      return NextResponse.json(
        { code: 500, data: null, message: "Internal server error" },
        { status: 500 },
      );
    }

    return NextResponse.json({ code: 200, data: null, message: "OK" });
  } catch (error) {
    // 签名验证失败（receiver.receive 抛出）返回 401
    console.error("[webhook livekit] signature verification failed:", error);
    return NextResponse.json(
      { code: 401, data: null, message: "Webhook signature verification failed" },
      { status: 401 },
    );
  }
}

/**
 * 根据 webhook 事件类型更新数据库。
 * 所有查询通过 roomName / egressId 定位会议，找不到则忽略（幂等）。
 */
async function handleEvent(event: WebhookEvent): Promise<void> {
  switch (event.event) {
    case "room_started":
      await handleRoomStarted(event);
      break;
    case "room_finished":
      await handleRoomFinished(event);
      break;
    case "participant_joined":
      await handleParticipantJoined(event);
      break;
    case "participant_left":
      await handleParticipantLeft(event);
      break;
    case "egress_ended":
      await handleEgressEnded(event);
      break;
    default:
      // 未处理的事件类型，安全忽略
      break;
  }
}

/** room_started：会议状态改为 active */
async function handleRoomStarted(event: WebhookEvent): Promise<void> {
  const roomName = event.room?.name;
  if (!roomName) return;

  await runWithAuthOp("webhook", async (tx) => {
    await tx.meeting.updateMany({
      where: { roomName, status: { in: ["scheduled", "active"] } },
      data: { status: "active" },
    });
  });
}

/** room_finished：会议状态改为 ended */
async function handleRoomFinished(event: WebhookEvent): Promise<void> {
  const roomName = event.room?.name;
  if (!roomName) return;

  await runWithAuthOp("webhook", async (tx) => {
    await tx.meeting.updateMany({
      where: { roomName, status: { not: "ended" } },
      data: { status: "ended", endedAt: new Date() },
    });
  });
}

/** participant_joined：upsert 参与者记录 */
async function handleParticipantJoined(event: WebhookEvent): Promise<void> {
  const roomName = event.room?.name;
  const identity = event.participant?.identity;
  if (!roomName || !identity) return;

  await runWithAuthOp("webhook", async (tx) => {
    const meeting = await tx.meeting.findFirst({
      where: { roomName },
      select: { id: true, createdBy: true },
    });
    if (!meeting) return;

    const role = meeting.createdBy === identity ? "host" : "guest";
    await tx.meetingParticipant.upsert({
      where: { meetingId_userId: { meetingId: meeting.id, userId: identity } },
      create: {
        meetingId: meeting.id,
        userId: identity,
        role,
        joinedAt: new Date(),
        leftAt: null,
      },
      update: {
        joinedAt: new Date(),
        leftAt: null,
        role,
      },
    });
  });
}

/** participant_left：标记参与者离开 */
async function handleParticipantLeft(event: WebhookEvent): Promise<void> {
  const roomName = event.room?.name;
  const identity = event.participant?.identity;
  if (!roomName || !identity) return;

  await runWithAuthOp("webhook", async (tx) => {
    const meeting = await tx.meeting.findFirst({
      where: { roomName },
      select: { id: true },
    });
    if (!meeting) return;

    await tx.meetingParticipant.updateMany({
      where: { meetingId: meeting.id, userId: identity, leftAt: null },
      data: { leftAt: new Date() },
    });
  });
}

/** egress_ended：回填录制文件 URL */
async function handleEgressEnded(event: WebhookEvent): Promise<void> {
  const egressInfo = event.egressInfo;
  if (!egressInfo) return;

  const egressId = egressInfo.egressId;
  const roomName = egressInfo.roomName;
  // 从 fileResults 提取录制文件存储位置（S3 URL 等）
  const recordingUrl = egressInfo.fileResults[0]?.location ?? null;

  await runWithAuthOp("webhook", async (tx) => {
    // 通过 roomName 定位会议，再校验 egressId 匹配（recordingUrl 含该 egressId）
    const where = roomName
      ? { roomName, recordingUrl: { contains: egressId } }
      : { recordingUrl: { contains: egressId } };

    if (recordingUrl) {
      await tx.meeting.updateMany({
        where,
        data: {
          recordingUrl,
          recordingStoppedAt: new Date(),
        },
      });
    } else {
      // 无文件 URL 时仅标记停止时间
      await tx.meeting.updateMany({
        where,
        data: { recordingStoppedAt: new Date() },
      });
    }
  });
}