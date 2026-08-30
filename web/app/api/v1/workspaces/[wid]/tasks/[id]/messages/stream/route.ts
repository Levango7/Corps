import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace, withGuc } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { chatEvents, chatChannel, emitChatEvent, type ChatEvent } from "@/lib/chat-events";

/**
 * GET /v1/workspaces/{wid}/tasks/{id}/messages/stream — SSE 实时推送
 *
 * 返回 text/event-stream 长连接，持续推送聊天事件：
 *  - message：新消息（含作者、附件、已读列表）
 *  - read：已读更新
 *  - presence：在线状态变更
 *  - ping：30 秒心跳保活
 *
 * 查询参数：
 *  - since: ISO 8601 时间戳，连接建立时补拉 since 之后的所有消息（断线重连补偿）。
 *
 * 认证：从 cookie 读取 access_token，验证工作区成员身份。
 * RLS：通过 runWithWorkspace 注入工作区上下文，跨工作区请求被拦截。
 *
 * 实现说明：
 *  - 使用 ReadableStream + TextEncoder 构造 SSE 流（Next.js Route Handler 原生支持）。
 *  - 单实例 pub/sub 通过 EventEmitter（chat-events.ts），MVP 不依赖 Redis。
 *  - 心跳 30 秒，空闲 5 分钟自动断开（避免连接泄漏）。
 *  - 连接建立时 upsert ChatPresence 标记在线，断开时 emit offline 事件。
 */

/** 心跳间隔：30 秒 */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** 空闲超时：5 分钟无任何事件自动断开 */
const IDLE_TIMEOUT_MS = 5 * 60_000;
/** SSE 事件序列化 */
const encoder = new TextEncoder();

function sseFrame(event: ChatEvent): Uint8Array {
  // SSE 协议：`data: <json>\n\n`
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  // SSE 连接建立限流（审计 P2）：每客户端每分钟最多 20 次连接建立——
  // 正常使用（断线重连）远低于此，但可防单客户端灌大量长连接占句柄。
  // 心跳/空闲断开只兜底泄漏，不约束连接建立频率。
  const limited = await checkRateLimit(req, "sse", { windowMs: 60_000, max: 20 });
  if (limited) return limited;

  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  // 校验任务确实属于本工作区（防跨租户订阅）
  const taskExists = await runWithWorkspace(
    wid,
    (tx) => tx.task.findFirst({ where: { id, workspaceId: wid }, select: { id: true } }),
    ctx.payload.sub,
  );
  if (!taskExists) {
    return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });
  }

  const userId = ctx.payload.sub;
  const channel = chatChannel(id);

  // 断线重连补偿：补拉 since 之后的所有消息
  const sinceParam = req.nextUrl.searchParams.get("since");
  let backlog: unknown[] = [];
  if (sinceParam) {
    const since = new Date(sinceParam);
    if (!Number.isNaN(since.getTime())) {
      backlog = await runWithWorkspace(
        wid,
        (tx) =>
          tx.message.findMany({
            where: {
              taskId: id,
              task: { workspaceId: wid },
              createdAt: { gt: since },
            },
            include: {
              author: { select: { id: true, name: true, email: true, image: true } },
              reads: { select: { userId: true, readAt: true } },
              attachments: true,
            },
            orderBy: { createdAt: "asc" },
            take: 200,
          }),
        userId,
      );
    }
  }

  // 标记当前用户在线（upsert ChatPresence；经 GUC 短事务——chat_presences
  // 受 FORCE RLS，按 task→workspace 关联套租户谓词）
  await withGuc({ workspace_id: wid, user_id: userId }, (tx) =>
    tx.chatPresence.upsert({
      where: { taskId_userId: { taskId: id, userId } },
      create: { taskId: id, userId },
      update: { lastSeen: new Date() },
    }),
  ).catch(() => {
    // 在线状态写入失败不阻塞 SSE 连接（容错降级）
  });

  // 广播当前用户上线
  emitChatEvent(id, { type: "presence", taskId: id, userId, online: true });

  // cleanup 闭包：cancel 回调通过外层变量引用，确保正确释放资源
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 1. 推送断线补偿消息
      for (const msg of backlog) {
        controller.enqueue(sseFrame({ type: "message", message: msg }));
      }

      // 2. 订阅聊天事件
      const listener = (event: ChatEvent) => {
        try {
          controller.enqueue(sseFrame(event));
        } catch {
          // controller 已关闭，忽略
        }
      };
      chatEvents.on(channel, listener);

      // 3. 心跳定时器（保活 + 同步刷新在线状态）
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(sseFrame({ type: "ping" }));
        } catch {
          // 流已关闭
        }
        // 刷新在线状态（容错；同上经 GUC 短事务——心跳回调不可持长事务）
        withGuc({ workspace_id: wid, user_id: userId }, (tx) =>
          tx.chatPresence.update({
            where: { taskId_userId: { taskId: id, userId } },
            data: { lastSeen: new Date() },
          }),
        ).catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);

      // 4. 空闲超时自动断开
      const idleTimeout = setTimeout(() => {
        // 审计修复（2026-08-29）：生产者侧 controller.close() 不会触发底层源的
        // cancel() 回调，必须在此显式执行 cleanup 才能释放 listener/定时器/presence。
        const fn = cleanup;
        fn?.();
      }, IDLE_TIMEOUT_MS);

      // 5. 注册清理函数：取消订阅 + 清除定时器 + 广播离线
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
        chatEvents.off(channel, listener);
        clearInterval(heartbeat);
        clearTimeout(idleTimeout);
        // 广播离线并清理在线状态记录（异步，不阻塞；经 GUC 短事务）
        withGuc({ workspace_id: wid, user_id: userId }, (tx) =>
          tx.chatPresence.delete({ where: { taskId_userId: { taskId: id, userId } } }),
        ).catch(() => {});
        emitChatEvent(id, { type: "presence", taskId: id, userId, online: false });
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
