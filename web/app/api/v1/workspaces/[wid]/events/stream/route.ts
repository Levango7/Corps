import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { apiMsg } from "@/lib/api-messages";
import { logger } from "@/lib/logger";
import {
  acquireSseSlot,
  emitWorkspaceEvent,
  subscribeWorkspaceEvents,
  type WorkspaceEvent,
} from "@/lib/workspace-events";

/**
 * GET /v1/workspaces/{wid}/events/stream — 工作区级 SSE 实时推送
 *
 * 返回 text/event-stream 长连接，持续推送工作区事件：
 *  - task.created：新建任务
 *  - task.updated：任务变更（标题/状态等）
 *  - task.deleted：任务删除
 *  - presence.online / presence.offline：成员上下线
 *  - ping：30 秒心跳保活（SSE 注释行 `: heartbeat\n\n`）
 *
 * 认证：getWorkspaceContext 校验工作区成员身份 + RLS 上下文。
 * 限流：复用 chat-events 的 SSE 连接建立限流（每分钟 20 次）+ 单用户并发上限 5。
 *
 * 实现说明：
 *  - 使用 ReadableStream + TextEncoder 构造 SSE 流（Next.js Route Handler 原生支持）。
 *  - 单实例 pub/sub 通过 EventEmitter（workspace-events.ts），MVP 不依赖 Redis。
 *  - 心跳 30 秒，空闲 10 分钟自动断开（避免连接泄漏）。
 *  - 连接建立时广播 presence.online，断开时广播 presence.offline。
 *  - 连接关闭时清理 listener + 定时器 + SSE 额度（RAII 保证所有退出路径释放）。
 */

/** 心跳间隔：30 秒 */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** 空闲超时：10 分钟无任何事件自动断开 */
const IDLE_TIMEOUT_MS = 10 * 60_000;
/** SSE 帧序列化 */
const encoder = new TextEncoder();

/** 业务事件帧：`data: <json>\n\n` */
function sseDataFrame(event: WorkspaceEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** 心跳帧：SSE 注释行 `: heartbeat\n\n`（客户端不触发 onmessage，仅保活） */
function sseHeartbeatFrame(): Uint8Array {
  return encoder.encode(`: heartbeat\n\n`);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  // SSE 连接建立限流：每客户端每分钟最多 20 次连接建立
  const limited = await checkRateLimit(req, "sse", { windowMs: 60_000, max: 20 });
  if (limited) return limited;

  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  const userId = ctx.payload.sub;

  // 单用户并发 SSE 连接硬上限（复用 chat-events 的 RAII acquireSseSlot，
  // 跨 chat/workspace 通道共享额度，避免双倍占句柄）
  const releaseSseSlot = acquireSseSlot(userId);
  if (!releaseSseSlot) {
    return NextResponse.json(
      { code: 429, message: apiMsg(req, "tooManySseConnections"), data: null },
      { status: 429 },
    );
  }

  // 广播当前用户上线（其他订阅者会收到 presence.online）
  emitWorkspaceEvent(wid, { type: "presence.online", userId });

  logger.info("[SSE workspace] connected", { wid, userId });

  // cleanup 闭包：cancel 回调通过外层变量引用，确保正确释放资源
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 1. 订阅工作区事件（RAII 风格 subscribeWorkspaceEvents，
      //    返回幂等 unsubscribe 函数，确保监听器在连接断开时被移除）
      const listener = (event: WorkspaceEvent) => {
        try {
          controller.enqueue(sseDataFrame(event));
        } catch {
          // controller 已关闭，忽略
        }
      };
      const unsubscribe = subscribeWorkspaceEvents(wid, listener);

      // 2. 心跳定时器（30 秒发送 `: heartbeat\n\n` 保活）
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseHeartbeatFrame());
        } catch {
          // 流已关闭
        }
      }, HEARTBEAT_INTERVAL_MS);

      // 3. 空闲超时自动断开（10 分钟无任何事件）
      const idleTimeout = setTimeout(() => {
        // 生产者侧 controller.close() 不会触发 cancel()，必须显式执行 cleanup
        const fn = cleanup;
        fn?.();
      }, IDLE_TIMEOUT_MS);

      // 4. 注册清理函数：取消订阅 + 清除定时器 + 释放 SSE 额度 + 广播离线
      cleanup = () => {
        // 幂等：cancel() 与 idleTimeout 谁先到谁执行，后到者直接跳过
        const fn = cleanup;
        cleanup = null;
        if (!fn) return;
        try {
          controller.close();
        } catch {
          // 已关闭
        }
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(idleTimeout);
        releaseSseSlot();
        // 广播当前用户离线
        emitWorkspaceEvent(wid, { type: "presence.offline", userId });
        logger.info("[SSE workspace] disconnected", { wid, userId });
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