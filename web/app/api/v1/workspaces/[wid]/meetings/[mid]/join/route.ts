import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { AccessToken } from "livekit-server-sdk";

/**
 * POST /v1/workspaces/{wid}/meetings/{mid}/join — 加入会议（获取 LiveKit token）
 *
 * 流程：
 *  1. 校验会议存在且属于当前工作区
 *  2. 校验会议状态（scheduled/active 可加入，ended 不可）
 *  3. 校验人数未满（在线参与者 leftAt=null 的数量 < maxParticipants）
 *  4. upsert MeetingParticipant（joinedAt=now, leftAt=null）
 *  5. 使用 livekit-server-sdk 的 AccessToken 生成 LiveKit JWT
 *  6. 返回 { token, url, roomName }
 *
 * 权限分层：
 *  - host（会议创建者）：canPublish + canSubscribe + roomRecord（可发起录制）
 *  - guest：canPublish + canSubscribe（无录制权限）
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
    const userId = ctx.payload.sub;

    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        const meeting = await tx.meeting.findFirst({
          where: { id: mid, workspaceId: wid },
          select: {
            id: true,
            roomName: true,
            status: true,
            maxParticipants: true,
            createdBy: true,
            startedAt: true,
          },
        });
        if (!meeting) return { kind: "notFound" as const };

        // ended 会议不可加入
        if (meeting.status === "ended") return { kind: "ended" as const };

        // 在线人数检查（leftAt = null 视为仍在会议中）
        const onlineCount = await tx.meetingParticipant.count({
          where: { meetingId: mid, leftAt: null },
        });
        // 已在线的用户重新加入不计入新增，故先查是否已在线
        const existingOnline = await tx.meetingParticipant.findUnique({
          where: { meetingId_userId: { meetingId: mid, userId } },
          select: { id: true, leftAt: true },
        });
        const isOnline = existingOnline && existingOnline.leftAt === null;
        if (!isOnline && onlineCount >= meeting.maxParticipants) {
          return { kind: "full" as const };
        }

        // upsert 参与者记录：首次加入创建，再次加入重置 joinedAt/leftAt
        // 角色：创建者为 host，其余为 guest
        const isHost = meeting.createdBy === userId;
        const role = isHost ? "host" : "guest";
        await tx.meetingParticipant.upsert({
          where: { meetingId_userId: { meetingId: mid, userId } },
          create: {
            meetingId: mid,
            userId,
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

        // 会议处于 scheduled 且有人加入时自动转为 active（若尚未 active）
        if (meeting.status === "scheduled") {
          await tx.meeting.update({
            where: { id: mid },
            data: { status: "active", startedAt: meeting.startedAt ?? new Date() },
          });
        }

        return { kind: "ok" as const, roomName: meeting.roomName, isHost };
      },
      userId,
    );

    if (result.kind === "notFound")
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "meetingNotFound"), data: null },
        { status: 404 },
      );
    if (result.kind === "ended")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "meetingEnded"), data: null },
        { status: 409 },
      );
    if (result.kind === "full")
      return NextResponse.json(
        { code: 409, message: apiMsg(req, "meetingFull"), data: null },
        { status: 409 },
      );

    // 生成 LiveKit AccessToken（需查用户展示名）
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      throw new Error("LiveKit 未配置（缺少 LIVEKIT_API_KEY/SECRET/URL）");
    }

    const user = await runWithWorkspace(
      wid,
      (tx) =>
        tx.user.findUnique({
          where: { id: userId },
          select: { name: true, email: true },
        }),
      userId,
    );

    const ttlSeconds = Number(process.env.LIVEKIT_TOKEN_TTL) || 7200;
    const userName = user?.name ?? user?.email ?? userId;

    // 使用 livekit-server-sdk AccessToken 签发 JWT
    // 权限分层：host 有 roomRecord（录制权限），guest 无
    const token = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: userName,
      ttl: ttlSeconds,
    });
    token.addGrant({
      room: result.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      roomRecord: result.isHost,
    });
    const jwt = await token.toJwt();

    return NextResponse.json({
      code: 200,
      data: { token: jwt, url: livekitUrl, roomName: result.roomName },
    });
  } catch (error) {
    // LiveKit 未配置
    if (
      error instanceof Error &&
      error.message.includes("LiveKit 未配置")
    ) {
      console.error("[join meeting] LiveKit not configured:", error.message);
      return NextResponse.json(
        { code: 503, data: null, message: apiMsg(req, "internalError") },
        { status: 503 },
      );
    }
    console.error("[join meeting] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
