// GET  /api/v1/remote-control/signal?workspaceId=xxx — SSE 信令通道（接收）
// POST /api/v1/remote-control/signal — 发送信令消息
//
// ─── 信令通道架构 ─────────────────────────────────────────────
// Next.js 16 Route Handler 不支持 WebSocket upgrade，采用 SSE + POST 模式：
//  - GET：客户端通过 EventSource 长连接接收信令消息（text/event-stream）
//  - POST：客户端发送信令消息，服务端通过 EventEmitter 转发给目标用户的 SSE
//
// 信令消息类型见 lib/webrtc/signaling.ts 的 SignalingMessage 联合类型。
// 服务端事件总线见 lib/webrtc/remote-control-events.ts。
//
// 认证模式：getUserId → checkRateLimit → getWorkspaceContext
// 约定：{ code, data, message } 信封（POST），text/event-stream（GET）

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId, unauthorizedResponse } from "@/lib/ai/shared";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import {
  emitSignalingMessage,
  subscribeSignalingMessages,
  type SignalingEnvelope,
} from "@/lib/webrtc/remote-control-events";

// ─── 常量 ──────────────────────────────────────────────────────

/** 心跳间隔：15 秒（信令需要低延迟，比聊天 SSE 更频繁） */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** 空闲超时：10 分钟无任何事件自动断开 */
const IDLE_TIMEOUT_MS = 10 * 60_000;
/** SSE 事件序列化 */
const encoder = new TextEncoder();

/** SSE 帧：`data: <json>\n\n` */
function sseFrame(envelope: SignalingEnvelope): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`);
}

/** SSE 心跳帧（注释行，不触发客户端 onmessage） */
function sseHeartbeat(): Uint8Array {
  return encoder.encode(`: heartbeat\n\n`);
}

// ─── GET：SSE 信令通道 ────────────────────────────────────────

/**
 * GET /api/v1/remote-control/signal?workspaceId=xxx
 *
 * 建立 SSE 长连接，接收发给当前用户的信令消息。
 * 客户端用 EventSource 订阅，收到 message 事件后按 type 分发处理。
 */
export async function GET(req: NextRequest) {
  // 1) 连接建立限流
  const limited = await checkRateLimit(req, "rc-sse", {
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  // 2) 认证 + 工作区上下文
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json(
      { code: 400, message: apiMsg(req, "invalidParams"), data: null },
      { status: 400 },
    );
  }

  const ctx = await getWorkspaceContext(req, workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  const userId = ctx.payload.sub;

  // 3) 创建 SSE 流
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 订阅当前用户的信令消息
      const listener = (envelope: SignalingEnvelope) => {
        try {
          controller.enqueue(sseFrame(envelope));
        } catch {
          // controller 已关闭，忽略
        }
      };
      const unsubscribe = subscribeSignalingMessages(userId, listener);

      // 心跳定时器（保活，防止代理/负载均衡器超时断开）
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseHeartbeat());
        } catch {
          // 流已关闭
        }
      }, HEARTBEAT_INTERVAL_MS);

      // 空闲超时自动断开
      const idleTimeout = setTimeout(() => {
        const fn = cleanup;
        fn?.();
      }, IDLE_TIMEOUT_MS);

      // 注册清理函数
      cleanup = () => {
        const fn = cleanup;
        cleanup = null;
        if (!fn) return; // 幂等
        try {
          controller.close();
        } catch {
          // 已关闭
        }
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(idleTimeout);
      };
    },
    cancel() {
      cleanup?.();
      cleanup = null;
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 禁用 Next.js 响应缓冲，确保事件即时推送
      "X-Accel-Buffering": "no",
    },
  });
}

// ─── POST：发送信令消息 ──────────────────────────────────────

/** 信令消息 schema（判别联合，按 type 校验不同字段） */
const signalMessageSchema = z.object({
  type: z.enum([
    "offer",
    "answer",
    "ice-candidate",
    "request-control",
    "accept-control",
    "reject-control",
    "end-control",
  ]),
  fromUserId: z.string().uuid(),
  toUserId: z.string().uuid(),
  sessionId: z.string().uuid(),
  // 各类型特有字段（联合校验在应用层按 type 分发）
  sdp: z.string().optional(),
  candidate: z
    .object({
      candidate: z.string(),
      sdpMid: z.string().nullable(),
      sdpMLineIndex: z.number().nullable(),
      usernameFragment: z.string().nullable().optional(),
    })
    .optional(),
  // P0-fix: workspaceId 必填，强制工作区隔离校验（防跨工作区信令注入）
  workspaceId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

/**
 * POST /api/v1/remote-control/signal
 *
 * 发送信令消息。服务端通过 EventEmitter 转发给目标用户（toUserId）的 SSE 连接。
 *
 * Body: SignalingMessage（见 lib/webrtc/signaling.ts）
 */
export async function POST(req: NextRequest) {
  // 1) 基础认证
  const userId = await getUserId(req);
  if (!userId) return unauthorizedResponse(req);

  // 1.5) 限流：信令消息频率较高（ICE 候选可能批量），放宽到 120 次/分钟
  const limited = await checkRateLimit(req, "rc-signal-send", {
    windowMs: 60_000,
    max: 120,
  });
  if (limited) return limited;

  // 2) body 校验
  let body: z.infer<typeof signalMessageSchema>;
  try {
    const raw = await req.json();
    const parsed = signalMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: parsed.error.issues[0]?.message ?? apiMsg(req, "remoteControlSignalInvalid"),
          data: null,
        },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(
      {
        code: 400,
        message: apiMsg(req, "remoteControlSignalInvalid"),
        data: null,
      },
      { status: 400 },
    );
  }

  // 3) 安全校验：fromUserId 必须是当前用户（防伪造发送方）
  if (body.fromUserId !== userId) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "forbidden"), data: null },
      { status: 403 },
    );
  }

  // 4) 工作区隔离校验（P0-fix: workspaceId 必填，强制校验当前用户是该工作区成员）
  const ctx = await getWorkspaceContext(req, body.workspaceId);
  if (!ctx) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "forbidden"), data: null },
      { status: 403 },
    );
  }

  // 5) P0-fix: 信令归属校验——sessionId 对应的 RemoteControlSession 必须存在，
  //    status 为 active/pending，且 fromUserId/toUserId 必须是会话的参与方
  //    （initiatorId/targetId），防认证用户向任意用户发送信令
  try {
    const session = await runWithWorkspace(
      body.workspaceId,
      (tx) =>
        tx.remoteControlSession.findUnique({
          where: { id: body.sessionId },
          select: {
            id: true,
            status: true,
            initiatorId: true,
            targetId: true,
            expiresAt: true,
          },
        }),
      userId,
    );

    if (!session) {
      return NextResponse.json(
        {
          code: 404,
          message: apiMsg(req, "remoteControlSessionNotFound"),
          data: null,
        },
        { status: 404 },
      );
    }

    // 会话状态必须为 active 或 pending（rejected/ended/failed 不允许发信令）
    if (session.status !== "active" && session.status !== "pending") {
      return NextResponse.json(
        {
          code: 403,
          message: apiMsg(req, "remoteControlAlreadyProcessed"),
          data: null,
        },
        { status: 403 },
      );
    }

    // 会话过期检查
    if (session.expiresAt < new Date()) {
      return NextResponse.json(
        {
          code: 403,
          message: apiMsg(req, "remoteControlSessionExpired"),
          data: null,
        },
        { status: 403 },
      );
    }

    // fromUserId 和 toUserId 必须是会话的参与方（initiatorId/targetId）
    const participants = new Set([session.initiatorId, session.targetId]);
    if (!participants.has(body.fromUserId) || !participants.has(body.toUserId)) {
      return NextResponse.json(
        {
          code: 403,
          message: apiMsg(req, "remoteControlNotParticipant"),
          data: null,
        },
        { status: 403 },
      );
    }
  } catch (error) {
    console.error("[POST remote-control/signal] session check error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }

  // 6) 通过 EventEmitter 转发给目标用户
  try {
    emitSignalingMessage(body.toUserId, body);
    return NextResponse.json({
      code: 0,
      data: null,
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    console.error("[POST remote-control/signal] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
