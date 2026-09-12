/**
 * y-websocket 协同服务端（独立 Node.js WebSocket 服务）。
 *
 * 设计文档 §3.1.2（L816-869）：独立 Node.js 服务，不嵌入 Next.js，
 * 避免 Serverless 冷启动丢失内存中 Yjs CRDT 状态。
 *
 * 职责：
 *  1. WebSocket 服务（端口 1234，通过 Nginx 反代 /collab → wss://collab:1234）
 *  2. JWT 鉴权（URL ?token={jwt}，payload 结构与 web/lib/jwt.ts 一致：{ sub, wid, role }）
 *  3. 工作区成员权限验证（查 Prisma Member 表）
 *  4. 文档归属验证（documentId 必须属于 wid 工作区）
 *  5. Yjs CRDT 同步协议（自行实现，因 y-websocket v3 npm 包仅导出客户端）
 *  6. 状态持久化（通过 PrismaYjsPersistence 存入 PostgreSQL）
 *
 * URL 格式：/collab/{documentId}?wid={workspaceId}&token={jwt}
 *
 * ─── 运行时依赖 ──────────────────────────────────────────────
 * 本文件属于独立协同服务（server/collab/），不在 web/ 的 tsconfig 范围内。
 * 运行时需要以下依赖（在 server/ 下独立安装或与 web/ 共享 node_modules）：
 *   - ws（WebSocket 服务端）+ @types/ws
 *   - jsonwebtoken（JWT 验证，已在 web/dependencies）
 *   - @prisma/client（Prisma Client）
 *   - yjs（CRDT 库）
 *   - lib0（Yjs 底层 encoding/decoding 工具）
 *
 * 启动方式：tsx server/collab/y-websocket-server.ts
 * 环境变量：
 *   - JWT_ACCESS_SECRET（JWT 签名密钥，与 web/ 共享）
 *   - DATABASE_URL（PostgreSQL 连接串，与 web/ 共享）
 *   - COLLAB_WS_PORT（WebSocket 端口，默认 1234）
 */

import { WebSocketServer, WebSocket } from "ws";
import { URL } from "node:url";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { PrismaYjsPersistence } from "./persistence";

// ─── y-websocket 二进制协议消息类型 ──────────────────────────
// 与 y-websocket 客户端（WebsocketProvider）协议一致
const messageSync = 0;
const messageQueryAwareness = 3;
const messageAwareness = 1;
// const messageAuth = 2; // 认证消息（本服务端在连接层鉴权，不走协议层 auth）

// ─── y-protocols/sync 消息类型 ──────────────────────────────
const messageYjsSyncStep1 = 0;
const messageYjsSyncStep2 = 1;
const messageYjsUpdate = 2;

// ─── JWT payload 结构（与 web/lib/jwt.ts JWTPayload 一致）────
interface CollabJWTPayload extends JwtPayload {
  sub: string;
  wid: string;
  role: string;
}

// ─── 文档连接管理 ────────────────────────────────────────────
interface DocState {
  /** Yjs CRDT 文档实例 */
  doc: Y.Doc;
  /** 当前连接到该文档的所有 WebSocket */
  connections: Set<WebSocket>;
  /** 是否已从 persistence 加载历史状态 */
  loaded: boolean;
}

/** 全局文档注册表：docName → DocState */
const docs = new Map<string, DocState>();

/** WebSocket 关联的文档名（用于连接关闭时清理） */
const connDocName = new WeakMap<WebSocket, string>();

// ─── 鉴权与权限验证 ──────────────────────────────────────────

/**
 * 验证 JWT 并返回 payload。
 *
 * 密钥缺失或验证失败（签名/过期/格式）统一返回 null。
 * 与 web/lib/jwt.ts 的 verifyAccessToken 逻辑一致，但独立实现
 * （server/ 不依赖 web/ 的 Next.js 上下文）。
 */
function verifyToken(token: string): CollabJWTPayload | null {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    console.error("Missing JWT_ACCESS_SECRET environment variable");
    return null;
  }
  try {
    const issuer = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const decoded = jwt.verify(token, secret, {
      issuer,
      algorithms: ["HS256"],
    });
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      typeof decoded.sub === "string" &&
      typeof decoded.wid === "string"
    ) {
      return decoded as CollabJWTPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 验证用户是否为指定工作区的成员。
 *
 * 查 Prisma Member 表（复合主键 userId + workspaceId）。
 * viewer 角色也允许只读协同（前端控制是否允许编辑）。
 */
async function verifyMembership(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const member = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  });
  return member !== null;
}

/**
 * 验证文档属于指定工作区（防止跨工作区越权访问）。
 */
async function verifyDocumentOwnership(
  prisma: PrismaClient,
  documentId: string,
  workspaceId: string,
): Promise<boolean> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { workspaceId: true },
  });
  return document?.workspaceId === workspaceId;
}

// ─── Yjs 同步协议实现 ────────────────────────────────────────

/**
 * 处理来自客户端的 WebSocket 消息。
 *
 * 解码 y-websocket 二进制协议，分发到对应处理器：
 * - messageSync: CRDT 同步（syncStep1/SyncStep2/Update）
 * - messageQueryAwareness: 查询 awareness（新连接获取在线用户光标）
 * - messageAwareness: awareness 更新（光标/选区/用户信息变更）
 */
function handleMessage(
  conn: WebSocket,
  data: Buffer,
  state: DocState,
  docName: string,
  persistence: PrismaYjsPersistence,
): void {
  const decoder = decoding.createDecoder(new Uint8Array(data));
  const messageType = decoding.readVarUint(decoder);
  const encoder = encoding.createEncoder();

  switch (messageType) {
    case messageSync: {
      encoding.writeVarUint(encoder, messageSync);
      const syncType = decoding.readVarUint(decoder);
      switch (syncType) {
        case messageYjsSyncStep1: {
          // 客户端发送其 stateVector，服务端回复 SyncStep2（客户端缺失的 update）
          encoding.writeVarUint(encoder, messageYjsSyncStep2);
          const clientStateVector = decoding.readVarUint8Array(decoder);
          encoding.writeVarUint8Array(
            encoder,
            Y.encodeStateAsUpdate(state.doc, clientStateVector),
          );
          send(conn, encoding.toUint8Array(encoder));
          break;
        }
        case messageYjsSyncStep2:
        case messageYjsUpdate: {
          // 客户端发来的 update（SyncStep2 或增量 Update）→ applyUpdate 到 doc
          // applyUpdate 触发 doc.on('update') 事件，在回调中广播 + 持久化
          // origin=conn 标记更新来源，避免回广播给发送方
          const update = decoding.readVarUint8Array(decoder);
          Y.applyUpdate(state.doc, update, conn);
          break;
        }
        default:
          // 未知 sync 消息类型，忽略（向前兼容）
          break;
      }
      break;
    }
    case messageQueryAwareness: {
      // 客户端请求当前 awareness 状态
      // MVP 策略：不维护服务端 awareness 池，回复空 awareness
      // （新连接的客户端暂时看不到历史光标，但后续实时 awareness 更新会立即同步）
      // 生产环境可升级为维护 Awareness 实例（y-protocols/awareness）
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, new Uint8Array(0));
      send(conn, encoding.toUint8Array(encoder));
      break;
    }
    case messageAwareness: {
      // 客户端 awareness 更新（光标/选区/用户在线状态）→ 转发给同文档其他连接
      const awarenessUpdate = decoding.readVarUint8Array(decoder);
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(encoder, awarenessUpdate);
      const message = encoding.toUint8Array(encoder);
      broadcast(state, message, conn);
      break;
    }
    default:
      // 未知消息类型，忽略（向前兼容）
      break;
  }

  // persistence 在 doc.on('update') 中统一处理，此处不重复
  void docName;
  void persistence;
}

/**
 * 安全发送二进制消息到 WebSocket 连接。
 */
function send(conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState === WebSocket.OPEN) {
    conn.send(message);
  }
}

/**
 * 广播消息到文档的所有连接（可选排除发送方）。
 */
function broadcast(state: DocState, message: Uint8Array, exclude?: WebSocket): void {
  for (const peer of state.connections) {
    if (peer !== exclude) {
      send(peer, message);
    }
  }
}

// ─── 连接建立与文档管理 ──────────────────────────────────────

/**
 * 建立 WebSocket 连接到指定文档，初始化 CRDT 同步。
 *
 * 自行实现 y-websocket 的 setupWSConnection 逻辑（v3 npm 包不含服务端 utils）：
 * 1. 获取或创建 DocState（Y.Doc + 连接集合）
 * 2. 首次访问时从 persistence 加载历史状态
 * 3. 发送 syncStep1（服务端 stateVector）给客户端，触发双向同步
 * 4. 注册 doc.on('update') 监听器：持久化 + 广播给其他连接
 * 5. 注册连接消息/关闭监听器
 */
async function setupWSConnection(
  conn: WebSocket,
  docName: string,
  persistence: PrismaYjsPersistence,
): Promise<void> {
  let state = docs.get(docName);

  if (!state) {
    const ydoc = new Y.Doc();
    state = { doc: ydoc, connections: new Set(), loaded: false };
    docs.set(docName, state);

    // 从 persistence 加载历史 CRDT 状态
    try {
      const savedState = await persistence.loadState(docName);
      if (savedState) {
        Y.applyUpdate(ydoc, savedState);
      }
      state.loaded = true;
    } catch (error) {
      console.error(`Failed to load persistence for doc ${docName}:`, error);
      // 加载失败不中断连接——客户端将从空文档开始，后续同步会补全
      state.loaded = true;
    }

    // 监听 Y.Doc update 事件：持久化 + 广播给其他连接
    // origin 标识更新来源（applyUpdate 的第三个参数）：
    //   - origin=conn：来自某 WebSocket 客户端的更新 → 广播给其他客户端
    //   - origin=undefined：来自 persistence 加载的更新 → 不广播（历史状态）
    ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      // 持久化增量更新（异步，不阻塞广播）
      persistence.storeUpdate(docName, update).catch((err) => {
        console.error(`Persistence storeUpdate error for doc ${docName}:`, err);
      });

      // 广播给其他连接（排除触发更新的来源连接）
      if (origin !== null && origin !== undefined) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        encoding.writeVarUint(encoder, messageYjsUpdate);
        encoding.writeVarUint8Array(encoder, update);
        const message = encoding.toUint8Array(encoder);
        broadcast(state!, message, origin as WebSocket);
      }
    });

    // 文档销毁时清理注册表
    ydoc.on("destroy", () => {
      docs.delete(docName);
    });
  }

  // 等待 persistence 加载完成（首次创建时已 await，此处对已存在 doc 是同步的）
  state.connections.add(conn);
  connDocName.set(conn, docName);

  // 发送 syncStep1（服务端的状态向量）给客户端
  // 客户端收到后会回复 syncStep2（其缺失的 update），完成双向同步
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  encoding.writeVarUint(encoder, messageYjsSyncStep1);
  encoding.writeVarUint8Array(encoder, Y.encodeStateVector(state.doc));
  send(conn, encoding.toUint8Array(encoder));
}

// ─── 服务启动 ────────────────────────────────────────────────

/**
 * 启动协同 WebSocket 服务。
 *
 * 可独立调用（直接运行本文件），也可被外部编排导入调用。
 */
export async function startCollabServer(options?: {
  port?: number;
  prisma?: PrismaClient;
}): Promise<{ wss: WebSocketServer; close: () => Promise<void> }> {
  const port = options?.port ?? Number(process.env.COLLAB_WS_PORT) ?? 1234;
  const prisma = options?.prisma ?? new PrismaClient();
  const persistence = new PrismaYjsPersistence(prisma);

  const wss = new WebSocketServer({ port });

  wss.on("connection", async (conn: WebSocket, req) => {
    // 解析 URL：/collab/{documentId}?wid={workspaceId}&token={jwt}
    const reqUrl = req.url ?? "/";
    const parsed = new URL(reqUrl, "http://localhost");
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    // 期望格式：/collab/{documentId}
    const documentId = pathSegments.length >= 2 && pathSegments[0] === "collab"
      ? pathSegments[1]
      : pathSegments[pathSegments.length - 1];
    const workspaceId = parsed.searchParams.get("wid");
    const token = parsed.searchParams.get("token");

    // 参数校验
    if (!documentId || !workspaceId || !token) {
      conn.close(4001, "Missing required parameters");
      return;
    }

    // JWT 鉴权
    const payload = verifyToken(token);
    if (!payload) {
      conn.close(4001, "Unauthorized: invalid or expired token");
      return;
    }

    // 工作区成员权限验证
    try {
      const isMember = await verifyMembership(prisma, payload.sub, workspaceId);
      if (!isMember) {
        conn.close(4003, "Forbidden: not a workspace member");
        return;
      }

      // 文档归属验证（防跨工作区越权）
      const isOwned = await verifyDocumentOwnership(prisma, documentId, workspaceId);
      if (!isOwned) {
        conn.close(4044, "Document not found in this workspace");
        return;
      }
    } catch (error) {
      console.error("Permission verification error:", error);
      conn.close(4500, "Internal server error during permission check");
      return;
    }

    // 建立协同连接
    try {
      await setupWSConnection(conn, documentId, persistence);

      // 消息处理
      conn.on("message", (data: Buffer) => {
        const state = docs.get(documentId);
        if (state) {
          handleMessage(conn, data, state, documentId, persistence);
        }
      });

      // 连接关闭：清理连接集合，无连接时销毁 Y.Doc 释放内存
      conn.on("close", () => {
        const state = docs.get(documentId);
        if (state) {
          state.connections.delete(conn);
          if (state.connections.size === 0) {
            // 最后一个连接断开：销毁 Y.Doc（persistence 已保存最新状态）
            state.doc.destroy();
            docs.delete(documentId);
          }
        }
      });

      // 错误处理
      conn.on("error", (error) => {
        console.error(`WebSocket error on doc ${documentId}:`, error);
        conn.close(1011, "Internal error");
      });
    } catch (error) {
      console.error("Failed to setup WS connection:", error);
      conn.close(1011, "Failed to establish collaboration session");
    }
  });

  // WebSocket 服务错误
  wss.on("error", (error) => {
    console.error("WebSocket server error:", error);
  });

  console.info(`[collab] y-websocket server listening on port ${port}`);

  /**
   * 优雅关闭：关闭 WebSocket 服务 + 断开 Prisma 连接。
   */
  const close = async (): Promise<void> => {
    // 关闭所有 WebSocket 连接
    wss.clients.forEach((client) => {
      client.close(1001, "Server shutting down");
    });
    wss.close();
    // 销毁所有 Y.Doc
    for (const state of docs.values()) {
      state.doc.destroy();
    }
    docs.clear();
    // 断开数据库连接
    await persistence.close();
    if (!options?.prisma) {
      await prisma.$disconnect();
    }
  };

  return { wss, close };
}

// ─── 直接运行入口 ────────────────────────────────────────────
// 当本文件被直接执行（tsx server/collab/y-websocket-server.ts）时启动服务
if (require.main === module) {
  startCollabServer().catch((error) => {
    console.error("Failed to start collab server:", error);
    process.exit(1);
  });

  // 优雅关闭信号处理
  const shutdown = async () => {
    console.info("[collab] shutting down...");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}