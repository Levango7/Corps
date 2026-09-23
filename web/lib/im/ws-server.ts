/**
 * IM WebSocket 服务端连接管理器（单例）
 *
 * 职责：
 *  - 管理所有 WebSocket 连接的生命周期（认证、订阅、断开）
 *  - 维护 userId → 多设备 socket 的映射（同一用户可多端同时在线）
 *  - 维护 conversationId → 订阅 socket 的双向索引
 *  - 广播消息到会话所有订阅者（新消息、编辑、撤回、正在输入、已读、在线状态）
 *
 * 认证流程：
 *  主路径（推荐）：WebSocket upgrade 时从 httpOnly cookie 提取 access_token 验证，
 *  验证通过后调用 handleConnection(ws, userId) 传入预认证身份。
 *  备选路径：连接建立后客户端发送 auth 消息，服务端用 verifyAccessToken 验证。
 *  认证前不处理任何其他消息（subscribe/typing/read 等一律忽略）。
 *
 * 单实例限制（与 chat-events.ts 同构）：
 *  本管理器仅在单进程内维护连接映射。多实例部署（PM2 cluster / K8s 多 Pod）时，
 *  不同实例的连接无法互通，广播消息仅到达本实例的订阅者。
 *  升级路径：引入 Redis Pub/Sub 跨实例广播（接口不变，替换 broadcastToConversation 实现）。
 *
 * 依赖说明：
 *  本模块通过 IMWebSocket 接口解耦具体 WebSocket 实现，不直接依赖 `ws` 库。
 *  集成时需安装 `ws` 并将其 WebSocket 实例适配到 IMWebSocket 接口（见 route.ts 注释）。
 */

import { verifyAccessToken } from "@/lib/jwt";

import { withGuc } from "@/lib/auth";
import type {
  ClientMessage,
  ServerMessage,
  IMWebSocket,
} from "./types";
import { WS_OPEN } from "./types";

/** 单用户 WebSocket 连接数上限（多设备场景：PC + 手机 + 平板 + 余量） */
const MAX_WS_PER_USER = 5;

/** onerror 后等待 onclose 的超时时间（ms），超时后强制清理 */
const ONERROR_DISCONNECT_TIMEOUT_MS = 30_000;

/**
 * IM 连接管理器单例。
 *
 * 内部维护三张映射表：
 *  - userSockets：userId → 该用户的所有活跃 socket（多设备支持）
 *  - socketConversations：socket → 该 socket 订阅的所有 conversationId
 *  - conversationSockets：conversationId → 订阅该会话的所有 socket
 *
 * socketUser 记录 socket → 已认证 userId，认证前为 undefined。
 */
class IMConnectionManager {
  /** userId → 该用户的所有活跃 WebSocket 连接（多设备） */
  private userSockets: Map<string, Set<IMWebSocket>> = new Map();
  /** socket → 该 socket 订阅的所有 conversationId */
  private socketConversations: Map<IMWebSocket, Set<string>> = new Map();
  /** conversationId → 订阅该会话的所有 socket */
  private conversationSockets: Map<string, Set<IMWebSocket>> = new Map();
  /** socket → 已认证的 userId（认证前不存在于此映射） */
  private socketUser: Map<IMWebSocket, string> = new Map();
  /** socket → 连接绑定的工作区 ID（handleImUpgrade 时从 URL ?wid= 提取） */
  private socketWorkspace: Map<IMWebSocket, string> = new Map();
  /** conversationId → 该会话所属的工作区 ID（subscribe 时从 DB 查询缓存） */
  private conversationWorkspace: Map<string, string> = new Map();
  /** socket → onerror 超时定时器引用（防止 onclose 未触发时资源泄漏） */
  private socketErrorTimer: Map<IMWebSocket, ReturnType<typeof setTimeout>> = new Map();

  // ─── 连接生命周期 ────────────────────────────────────────────

  /**
   * 处理新 WebSocket 连接。
   *
   * @param ws WebSocket 连接实例（已适配到 IMWebSocket 接口）
   * @param preAuthUserId upgrade 阶段已认证的 userId（主路径）；undefined 表示需等待 auth 消息
   * @param boundWorkspaceId upgrade 阶段从 URL ?wid= 提取的工作区 ID（用于跨工作区隔离验证）
   *
   * 调用方在 WebSocket upgrade 成功后调用此方法。此方法注册 onmessage/onclose/onerror 回调，
   * 连接的后续处理由回调驱动。preAuthUserId 非空时跳过 auth 消息步骤。
   */
  async handleConnection(ws: IMWebSocket, preAuthUserId?: string, boundWorkspaceId?: string): Promise<void> {
    // 中等问题3：单用户 WebSocket 连接数限制
    if (preAuthUserId) {
      const currentCount = this.userSockets.get(preAuthUserId)?.size ?? 0;
      if (currentCount >= MAX_WS_PER_USER) {
        this.send(ws, {
          type: "error",
          message: `连接数超限：单用户最多 ${MAX_WS_PER_USER} 个并发 WebSocket 连接`,
        });
        ws.close(1008, "Too many connections");
        return;
      }
    }

    // 绑定工作区 ID（从 URL ?wid= 提取，用于 subscribe 时跨工作区隔离验证）
    if (boundWorkspaceId) {
      this.socketWorkspace.set(ws, boundWorkspaceId);
    }

    // 预认证：upgrade 阶段已从 cookie 验证身份，直接注册
    if (preAuthUserId) {
      this.registerAuthenticatedSocket(ws, preAuthUserId);
    }

    // 消息回调：解析 JSON 并分发处理
    ws.onmessage = (event: { data: string }) => {
      this.handleMessage(ws, event.data).catch((err: unknown) => {
        this.send(ws, {
          type: "error",
          message: `消息处理异常: ${err instanceof Error ? err.message : "unknown"}`,
        });
      });
    };

    // 关闭回调：清理资源并广播离线
    ws.onclose = () => {
      // 中等问题6：onclose 触发时取消 onerror 超时定时器
      const timer = this.socketErrorTimer.get(ws);
      if (timer) {
        clearTimeout(timer);
        this.socketErrorTimer.delete(ws);
      }
      this.handleDisconnect(ws);
    };

    // 错误回调：记录日志并启动超时兜底机制
    // 中等问题6：onerror 后 onclose 可能不触发（如网络层异常），
    // 启动 30 秒定时器，若 onclose 仍未触发则强制调用 handleDisconnect
    ws.onerror = (event: unknown) => {
      console.error("[im-ws] 连接错误:", event);
      if (!this.socketErrorTimer.has(ws)) {
        const timer = setTimeout(() => {
          console.warn("[im-ws] onerror 后 30s 未收到 onclose，强制清理连接");
          this.handleDisconnect(ws);
        }, ONERROR_DISCONNECT_TIMEOUT_MS);
        timer.unref?.(); // unref 避免阻止进程退出
        this.socketErrorTimer.set(ws, timer);
      }
    };
  }


  /**
   * 注册已认证的 socket：加入 userSockets 映射并广播上线。
   */
  private registerAuthenticatedSocket(ws: IMWebSocket, userId: string): void {
    this.socketUser.set(ws, userId);

    // 加入用户 socket 集合
    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(ws);

    // 广播上线状态（仅在该用户首次出现 socket 时广播，避免多设备重复广播）
    if (sockets.size === 1) {
      this.broadcastPresence(userId, true);
    }
  }

  // ─── 消息处理 ────────────────────────────────────────────────

  /**
   * 处理来自客户端的原始消息字符串。
   *
   * 解析 JSON → 校验 type → 分发到对应 handler。
   * 认证前仅处理 auth 消息，其余一律忽略并发 error。
   */
  private async handleMessage(ws: IMWebSocket, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "消息格式无效，期望合法 JSON" });
      return;
    }

    const userId = this.socketUser.get(ws);

    // 未认证：仅允许 auth 消息
    if (!userId) {
      if (msg.type === "auth") {
        await this.handleAuth(ws, msg.token);
      } else {
        this.send(ws, { type: "error", message: "未认证，请先发送 auth 消息" });
      }
      return;
    }

    // 已认证：分发处理
    switch (msg.type) {
      case "auth":
        // 重复认证：静默忽略（已认证连接无需再次认证）
        break;
      case "heartbeat":
        // 心跳：无需回复，服务端收到即视为连接活跃。
        // 客户端依赖 onclose 检测断线，不依赖心跳回复。
        break;
      case "subscribe":
        await this.handleSubscribe(ws, userId, msg.conversationId);
        break;
      case "unsubscribe":
        this.handleUnsubscribe(ws, msg.conversationId);
        break;
      case "typing":
        this.handleTyping(ws, userId, msg.conversationId, msg.isTyping);
        break;
      case "read":
        await this.handleRead(ws, userId, msg.conversationId, msg.messageIds);
        break;
      default:
        // 类型安全：switch 穷尽所有 ClientMessage 分支后此行不可达
        this.send(ws, { type: "error", message: `未知消息类型: ${(msg as { type: string }).type}` });
    }
  }

  /**
   * 处理 auth 消息：验证 JWT 并注册已认证 socket。
   */
  private async handleAuth(ws: IMWebSocket, token: string): Promise<void> {
    try {
      const payload = await verifyAccessToken(token);
      if (!payload) {
        this.send(ws, { type: "error", message: "认证失败：令牌无效或已过期" });
        return;
      }
      // 中等问题3：认证时也检查连接数限制
      const currentCount = this.userSockets.get(payload.sub)?.size ?? 0;
      if (currentCount >= MAX_WS_PER_USER) {
        this.send(ws, {
          type: "error",
          message: `连接数超限：单用户最多 ${MAX_WS_PER_USER} 个并发 WebSocket 连接`,
        });
        ws.close(1008, "Too many connections");
        return;
      }
      this.registerAuthenticatedSocket(ws, payload.sub);
    } catch (err) {
      this.send(ws, {
        type: "error",
        message: `认证异常: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  /**
   * 处理 subscribe：验证用户是该会话成员后加入订阅。
   *
   * 严重问题1修复：DB 操作通过 withGuc 注入 workspace_id GUC 上下文，确保 RLS 策略生效。
   * 严重问题2修复：验证 conversation.workspaceId 与连接绑定的工作区 ID 一致，
   *               防止跨工作区订阅（即使成员资格验证通过）。
   *
   * 查 ConversationMember 表确认成员资格，防跨会话窃听。
   * DB 操作 try-catch，失败时发 error 但不断开连接。
   */
  private async handleSubscribe(
    ws: IMWebSocket,
    userId: string,
    conversationId: string,
  ): Promise<void> {
    try {
      // 严重问题1：通过 withGuc 注入 RLS 上下文执行 DB 查询
      // 先查询会话所属工作区和成员资格（在同一 GUC 事务内完成）
      const boundWorkspaceId = this.socketWorkspace.get(ws);

      const { member, workspaceId } = await withGuc(
        boundWorkspaceId ? { workspace_id: boundWorkspaceId, user_id: userId } : { user_id: userId },
        async (tx) => {
          // 查询会话所属工作区
          const conversation = await tx.conversation.findUnique({
            where: { id: conversationId },
            select: { workspaceId: true },
          });
          if (!conversation) {
            return { member: null, workspaceId: null };
          }
          // 验证用户是该会话成员（防跨会话窃听）
          const member = await tx.conversationMember.findUnique({
            where: {
              conversationId_userId: { conversationId, userId },
            },
            select: { id: true },
          });
          return { member, workspaceId: conversation.workspaceId };
        },
      );

      if (!member || !workspaceId) {
        this.send(ws, { type: "error", message: "订阅失败：非该会话成员或会话不存在" });
        return;
      }

      // 严重问题2：验证 conversation.workspaceId 与连接绑定的 workspaceId 一致
      if (boundWorkspaceId && workspaceId !== boundWorkspaceId) {
        this.send(ws, {
          type: "error",
          message: "订阅失败：会话不属于当前工作区",
        });
        return;
      }

      // 缓存 conversation → workspaceId 映射，供 handleRead 使用
      this.conversationWorkspace.set(conversationId, workspaceId);

      // 加入 socket → conversation 双向索引
      let convSet = this.socketConversations.get(ws);
      if (!convSet) {
        convSet = new Set();
        this.socketConversations.set(ws, convSet);
      }
      convSet.add(conversationId);

      let sockSet = this.conversationSockets.get(conversationId);
      if (!sockSet) {
        sockSet = new Set();
        this.conversationSockets.set(conversationId, sockSet);
      }
      sockSet.add(ws);
    } catch (err) {
      this.send(ws, {
        type: "error",
        message: `订阅异常: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  /**
   * 处理 unsubscribe：从会话订阅双向索引中移除。
   */
  private handleUnsubscribe(ws: IMWebSocket, conversationId: string): void {
    // 从 socket → conversation 移除
    const convSet = this.socketConversations.get(ws);
    convSet?.delete(conversationId);

    // 从 conversation → socket 移除
    const sockSet = this.conversationSockets.get(conversationId);
    sockSet?.delete(ws);
    if (sockSet && sockSet.size === 0) {
      this.conversationSockets.delete(conversationId);
    }
  }

  /**
   * 处理 typing：广播正在输入状态给该会话其他订阅者。
   */
  private handleTyping(
    ws: IMWebSocket,
    userId: string,
    conversationId: string,
    isTyping: boolean,
  ): void {
    this.broadcastToConversation(
      conversationId,
      { type: "typing", conversationId, userId, isTyping },
      userId,
    );
  }

  /**
   * 处理 read：更新 DB 已读游标并广播已读回执给该会话其他订阅者。
   *
   * 严重问题1修复：通过 withGuc 注入 workspace_id GUC 上下文，确保 RLS 策略生效。
   * workspaceId 从 conversationWorkspace 缓存获取（subscribe 时已查询并缓存），
   * 若缓存未命中则从 socketWorkspace 获取连接绑定的工作区 ID。
   *
   * 更新 ConversationMember.lastReadAt 为当前时间（已读游标）。
   * 广播 read 事件让其他客户端显示双勾✓✓回执。
   */
  private async handleRead(
    ws: IMWebSocket,
    userId: string,
    conversationId: string,
    messageIds: string[],
  ): Promise<void> {
    try {
      // 严重问题1：获取 workspaceId 并通过 withGuc 注入 RLS 上下文
      const workspaceId =
        this.conversationWorkspace.get(conversationId) ??
        this.socketWorkspace.get(ws);

      const now = new Date();

      const readByCount = await withGuc(
        workspaceId ? { workspace_id: workspaceId, user_id: userId } : { user_id: userId },
        async (tx) => {
          // 读取当前 lastReadAt，用于防回退比较（对齐 REST API /read 端点逻辑）
          const membership = await tx.conversationMember.findUnique({
            where: {
              conversationId_userId: { conversationId, userId },
            },
            select: { id: true, lastReadAt: true },
          });
          if (!membership) return 0;

          // 防回退：只有当 now > existingDate（或 existingDate 为 null）时才更新
          const existingDate = membership.lastReadAt;
          if (!existingDate || now > existingDate) {
            await tx.conversationMember.update({
              where: { id: membership.id },
              data: { lastReadAt: now },
            });
          }

          // 计算 readByCount：该会话有多少成员的 lastReadAt >= 消息的 createdAt
          // 取 messageIds 中最早的消息 createdAt 作为基准
          if (messageIds.length === 0) return 0;
          const earliestMessage = await tx.message.findFirst({
            where: { id: { in: messageIds } },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
          });
          if (!earliestMessage) return 0;

          const readCount = await tx.conversationMember.count({
            where: {
              conversationId,
              lastReadAt: { gte: earliestMessage.createdAt },
            },
          });
          return readCount;
        },
      );

      // 广播已读回执给该会话其他订阅者（附带 readByCount）
      this.broadcastToConversation(
        conversationId,
        { type: "read", conversationId, userId, messageIds, readByCount },
        userId,
      );
    } catch (err) {
      this.send(ws, {
        type: "error",
        message: `已读上报异常: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  // ─── 广播 ────────────────────────────────────────────────────

  /**
   * 广播消息到指定会话的所有订阅者。
   *
   * @param conversationId 目标会话 ID
   * @param msg 要广播的服务端消息
   * @param excludeUserId 排除的 userId（通常是消息发送者本人，避免回声）
   *
   * 遍历该会话的所有订阅 socket，跳过已关闭的连接和 excludeUserId 的 socket。
   */
  broadcastToConversation(
    conversationId: string,
    msg: ServerMessage,
    excludeUserId?: string,
  ): void {
    const sockSet = this.conversationSockets.get(conversationId);
    if (!sockSet) return;

    for (const ws of sockSet) {
      // 跳过非 OPEN 状态的连接
      if (ws.readyState !== WS_OPEN) continue;

      // 跳过被排除的用户（避免回声）
      if (excludeUserId) {
        const wsUserId = this.socketUser.get(ws);
        if (wsUserId === excludeUserId) continue;
      }

      this.send(ws, msg);
    }
  }

  /**
   * 广播用户在线状态变更。
   *
   * 遍历该用户参与的所有会话，向每个会话的订阅者广播 presence 事件。
   * 由于无法从内存反查用户参与的所有会话（仅知道已订阅的会话），
   * 此处遍历该用户所有 socket 订阅的会话集合去重后广播。
   */
  broadcastPresence(userId: string, online: boolean): void {
    // 收集该用户所有 socket 订阅的会话 ID（去重）
    const conversationIds = new Set<string>();
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      for (const ws of sockets) {
        const convSet = this.socketConversations.get(ws);
        if (convSet) {
          for (const cid of convSet) {
            conversationIds.add(cid);
          }
        }
      }
    }

    // 向每个相关会话广播 presence（不排除本人，让多端同步在线状态）
    const presenceMsg: ServerMessage = { type: "presence", userId, online };
    for (const cid of conversationIds) {
      this.broadcastToConversation(cid, presenceMsg);
    }
  }

  // ─── 断开处理 ────────────────────────────────────────────────

  /**
   * 处理连接断开：清理所有映射并广播离线状态。
   *
   * 清理顺序：
   *  1. 取消 onerror 超时定时器（若有）
   *  2. 从 socketConversations 移除该 socket 的所有订阅
   *  3. 从 conversationSockets 对应移除该 socket
   *  4. 从 socketUser 移除
   *  5. 从 socketWorkspace 移除
   *  6. 若该用户已无任何 socket，广播 offline
   */
  private handleDisconnect(ws: IMWebSocket): void {
    // 取消 onerror 超时定时器
    const timer = this.socketErrorTimer.get(ws);
    if (timer) {
      clearTimeout(timer);
      this.socketErrorTimer.delete(ws);
    }

    const userId = this.socketUser.get(ws);

    // 清理 socket → conversation 索引，同步清理 conversation → socket
    const convSet = this.socketConversations.get(ws);
    if (convSet) {
      for (const cid of convSet) {
        const sockSet = this.conversationSockets.get(cid);
        sockSet?.delete(ws);
        if (sockSet && sockSet.size === 0) {
          this.conversationSockets.delete(cid);
          // 会话无订阅者时清理 workspaceId 缓存
          this.conversationWorkspace.delete(cid);
        }
      }
      this.socketConversations.delete(ws);
    }

    // 清理 socketUser
    this.socketUser.delete(ws);

    // 清理 socketWorkspace
    this.socketWorkspace.delete(ws);

    // 清理 userSockets，并在用户无剩余 socket 时广播离线
    if (userId) {
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
          // 该用户已无任何活跃连接，广播离线
          this.broadcastPresence(userId, false);
        }
      }
    }
  }

  // ─── 发送 ────────────────────────────────────────────────────

  /**
   * 向单个 socket 发送服务端消息。
   *
   * 序列化 JSON 后发送。发送失败（连接已关闭）静默忽略，
   * 不影响其他订阅者的广播。
   */
  private send(ws: IMWebSocket, msg: ServerMessage): void {
    if (ws.readyState !== WS_OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      // 发送失败通常意味着连接已断开，静默忽略
      console.error("[im-ws] 发送失败:", err);
    }
  }

  // ─── 诊断/测试辅助 ──────────────────────────────────────────

  /**
   * 获取当前在线用户数（诊断/监控用）。
   */
  getOnlineUserCount(): number {
    return this.userSockets.size;
  }

  /**
   * 获取当前活跃连接总数（含多设备）。
   */
  getConnectionCount(): number {
    return this.socketUser.size;
  }

  /**
   * 获取指定会话的订阅连接数。
   */
  getConversationSubscriberCount(conversationId: string): number {
    return this.conversationSockets.get(conversationId)?.size ?? 0;
  }
}

/**
 * IM 连接管理器单例。
 *
 * 全局唯一实例，由 route.ts / custom server 在 WebSocket upgrade 时调用。
 * 单例保证同一进程内所有连接共享同一份映射表。
 */
export const imManager = new IMConnectionManager();