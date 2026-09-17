import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

/**
 * 生成 LiveKit 访问令牌（JWT）。
 *
 * 项目已安装 livekit-server-sdk，但此处仍用 jsonwebtoken 手动构造 LiveKit 兼容的
 * JWT（HS256），以保持 token 字段构造的显式可控。LiveKit token payload 规范：
 *   - iss: API_KEY
 *   - sub: 参与者身份（userId）
 *   - aud: "livekit"
 *   - nbf / exp: 生效与过期时间（unix 秒）
 *   - video: { room, roomJoin, canPublish, canSubscribe, hidden }
 *   - jti: 唯一 ID（防重放）
 *   - name: 参与者展示名（可选）
 *
 * 需配置环境变量：LIVEKIT_API_KEY、LIVEKIT_API_SECRET、LIVEKIT_URL。
 * 缺失时抛错，由调用方捕获后返回 503。
 */
function issueLiveKitToken(opts: {
  identity: string;
  name?: string;
  roomName: string;
  ttlSeconds?: number;
}): { token: string; url: string; roomName: string } {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !livekitUrl) {
    throw new Error("LiveKit 未配置（缺少 LIVEKIT_API_KEY/SECRET/URL）");
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? 60 * 60 * 4; // 默认 4 小时
  const payload = {
    iss: apiKey,
    sub: opts.identity,
    aud: "livekit",
    nbf: now,
    exp: now + ttl,
    jti: randomUUID(),
    name: opts.name ?? opts.identity,
    video: {
      room: opts.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      hidden: false,
    },
  };

  const token = jwt.sign(payload, apiSecret, { algorithm: "HS256" });
  return { token, url: livekitUrl, roomName: opts.roomName };
}

/**
 * POST /v1/workspaces/{wid}/meetings/{mid}/join — 加入会议（获取 LiveKit token）
 *
 * 流程：
 *  1. 校验会议存在且属于当前工作区
 *  2. 校验会议状态（scheduled/active 可加入，ended 不可）
 *  3. 校验人数未满（在线参与者 leftAt=null 的数量 < maxParticipants）
 *  4. upsert MeetingParticipant（joinedAt=now, leftAt=null）
 *  5. 生成 LiveKit access token
 *  6. 返回 { token, url, roomName }
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
        const role = meeting.createdBy === userId ? "host" : "guest";
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

        return { kind: "ok" as const, roomName: meeting.roomName };
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

    // 生成 LiveKit token（需查用户展示名）
    const user = await runWithWorkspace(
      wid,
      (tx) =>
        tx.user.findUnique({
          where: { id: userId },
          select: { name: true, email: true },
        }),
      userId,
    );

    const { token, url, roomName } = issueLiveKitToken({
      identity: userId,
      name: user?.name ?? user?.email ?? userId,
      roomName: result.roomName,
    });

    return NextResponse.json({
      code: 200,
      data: { token, url, roomName },
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