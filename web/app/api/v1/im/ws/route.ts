/**
 * IM WebSocket upgrade 端点
 *
 * 路由：GET /api/v1/im/ws?wid={workspaceId}
 *
 * ─── Next.js 16 WebSocket 支持限制 ─────────────────────────────
 * Next.js 16 的 Route Handler（API Route）基于 Web Fetch API（Request/Response），
 * 不支持 HTTP 101 Switching Protocols（WebSocket upgrade）。WebSocket 需要访问
 * 底层 Node.js http.Server 的 upgrade 事件，这在 Route Handler 抽象层之上。
 *
 * 因此本端点采用两层架构：
 *  1. GET handler（本文件导出）：作为 API Route 占位，返回 426 Upgrade Required。
 *     在标准 `next dev` / `next start` 下提示 WebSocket 需 custom server。
 *  2. handleImUpgrade + authenticateUpgrade + adaptWs（本文件导出）：
 *     供 custom server 集成时调用的升级处理逻辑。custom server 示例见文件末尾注释。
 *
 * ─── Custom Server 集成步骤 ───────────────────────────────────
 * 1. 安装 ws 库：pnpm add ws && pnpm add -D @types/ws
 * 2. 在项目根创建 server.ts（见文件末尾注释中的完整示例）
 * 3. 用 `tsx server.ts` 或编译后 `node server.js` 启动，替代 `next dev`
 *
 * ─── 认证流程 ─────────────────────────────────────────────────
 * WebSocket upgrade 请求由浏览器发起，自动携带 httpOnly cookie（含 access_token）。
 * authenticateUpgrade 从 Node.js IncomingMessage 解析 cookie → 验证 JWT → 返回 userId。
 * 验证失败时拒绝 upgrade（socket.destroy()），不暴露 401 响应（WebSocket 协议限制）。
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import { verifyAccessToken } from "@/lib/jwt";
import { imManager } from "@/lib/im/ws-server";
import type { IMWebSocket } from "@/lib/im/types";
import type { IncomingMessage } from "http";

// ─── API Route 占位 handler ───────────────────────────────────

/**
 * GET /api/v1/im/ws — WebSocket upgrade 端点（API Route 占位）
 *
 * 在标准 Next.js 运行时下返回 426 Upgrade Required，
 * 提示需通过 custom server 处理 WebSocket upgrade。
 *
 * 认证逻辑仍在此执行（复用 authenticate），用于在非 WebSocket 客户端
 * 直接请求此端点时返回正确的 401 而非 426。
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // 验证认证（复用工作区无关的 authenticate，仅校验 token 有效性）
  const payload = await authenticate(req);
  if (!payload) {
    return NextResponse.json(
      { code: 401, message: "Unauthorized", data: null },
      { status: 401 },
    );
  }

  // 已认证但 Next.js Route Handler 无法处理 WebSocket upgrade
  return NextResponse.json(
    {
      code: 426,
      message:
        "WebSocket upgrade 需通过 custom server 处理。请使用 server.ts 启动（见 route.ts 注释）。",
      data: null,
    },
    { status: 426 },
  );
}

// ─── Custom Server 集成导出 ───────────────────────────────────

/**
 * 从 Node.js IncomingMessage 的 cookie 头解析出指定 cookie 值。
 *
 * 简单的 cookie 解析器（不依赖 cookie 库），仅处理 name=value 对。
 */
function parseCookie(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const name = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[name] = value;
  }
  return result;
}

/**
 * 认证 WebSocket upgrade 请求。
 *
 * 从 Node.js IncomingMessage 的 cookie 头提取 access_token，验证 JWT，
 * 返回认证通过的用户 ID。供 custom server 的 upgrade 事件处理调用。
 *
 * @param req Node.js HTTP 请求对象（upgrade 事件的第一个参数）
 * @returns 认证通过返回 userId，失败返回 null
 */
export async function authenticateUpgrade(req: IncomingMessage): Promise<string | null> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = parseCookie(cookieHeader);
  const token = cookies["access_token"];
  if (!token) return null;

  const payload = await verifyAccessToken(token);
  return payload?.sub ?? null;
}

// ─── WebSocket 适配器 ─────────────────────────────────────────

/**
 * ws 库 WebSocket 实例的最小接口（解耦具体依赖）。
 *
 * `ws` 库的 WebSocket 满足此接口。custom server 中将 ws.WebSocket
 * 传入 adaptWs 即可得到 IMWebSocket 适配器。
 */
export interface RawWebSocketLike {
  /** 连接状态（0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED） */
  readonly readyState: number;
  /** 发送文本/二进制数据 */
  send(data: string): void;
  /** 关闭连接 */
  close(code?: number, reason?: string): void;
  /** 注册消息监听器 */
  on(event: "message", listener: (data: Buffer | string | ArrayBuffer) => void): this;
  /** 注册关闭监听器 */
  on(event: "close", listener: (code: number, reason: Buffer | string) => void): this;
  /** 注册错误监听器 */
  on(event: "error", listener: (err: Error) => void): this;
  /** 注册连接建立监听器 */
  on(event: "open", listener: () => void): this;
}

/**
 * 将 ws 库的 WebSocket 实例适配到 IMWebSocket 接口。
 *
 * ws 库使用 EventEmitter 风格（.on("message", fn)），
 * IMWebSocket 使用浏览器风格（.onmessage = fn）。
 * 此适配器在两者间转换，使 ws-server.ts 的 handleConnection 能统一处理。
 *
 * @param rawWs ws 库的 WebSocket 实例（或满足 RawWebSocketLike 的任何对象）
 * @returns 符合 IMWebSocket 接口的适配器
 */
export function adaptWs(rawWs: RawWebSocketLike): IMWebSocket {
  const adapter: IMWebSocket = {
    get readyState(): number {
      return rawWs.readyState;
    },
    send(data: string): void {
      rawWs.send(data);
    },
    close(code?: number, reason?: string): void {
      rawWs.close(code, reason);
    },
    onmessage: null,
    onclose: null,
    onerror: null,
    onopen: null,
  };

  // ws 库事件 → IMWebSocket 回调
  rawWs.on("message", (data: Buffer | string | ArrayBuffer) => {
    adapter.onmessage?.({ data: data.toString() });
  });
  rawWs.on("close", (code: number, reason: Buffer | string) => {
    adapter.onclose?.({ code, reason: reason.toString() });
  });
  rawWs.on("error", (err: Error) => {
    adapter.onerror?.(err);
  });
  rawWs.on("open", () => {
    adapter.onopen?.();
  });

  return adapter;
}

/**
 * 处理 IM WebSocket upgrade 的完整流程（供 custom server 调用）。
 *
 * 封装认证 + 适配 + 注册到 imManager 的完整流程。
 * custom server 的 upgrade 事件中调用此函数即可。
 *
 * @param req Node.js HTTP 请求对象
 * @param rawWs ws 库的 WebSocket 实例（upgrade 回调的第三个参数）
 * @returns 认证并注册成功返回 true，认证失败返回 false
 */
export async function handleImUpgrade(
  req: IncomingMessage,
  rawWs: RawWebSocketLike,
): Promise<boolean> {
  const userId = await authenticateUpgrade(req);
  if (!userId) {
    return false;
  }
  const adapter = adaptWs(rawWs);
  await imManager.handleConnection(adapter, userId);
  return true;
}

// Re-export imManager 供 custom server 直接导入
export { imManager } from "@/lib/im/ws-server";

/*
 * ─── Custom Server 完整示例（server.ts）─────────────────────────
 *
 * 将以下代码保存为项目根的 server.ts，安装 ws 后运行 `tsx server.ts`：
 *
 *   import { createServer } from "http";
 *   import { parse } from "url";
 *   import next from "next";
 *   import { WebSocketServer } from "ws";
 *   import {
 *     authenticateUpgrade,
 *     adaptWs,
 *     imManager,
 *   } from "./web/app/api/v1/im/ws/route";
 *
 *   const dev = process.env.NODE_ENV !== "production";
 *   const app = next({ dev });
 *   const handle = app.getRequestHandler();
 *
 *   await app.prepare();
 *
 *   const server = createServer((req, res) => {
 *     handle(req, res);
 *   });
 *
 *   const wss = new WebSocketServer({ noServer: true });
 *
 *   server.on("upgrade", async (req, socket, head) => {
 *     const { pathname } = parse(req.url ?? "");
 *     if (pathname !== "/api/v1/im/ws") {
 *       socket.destroy();
 *       return;
 *     }
 *     const userId = await authenticateUpgrade(req);
 *     if (!userId) {
 *       socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
 *       socket.destroy();
 *       return;
 *     }
 *     wss.handleUpgrade(req, socket, head, (ws) => {
 *       const adapter = adaptWs(ws);
 *       imManager.handleConnection(adapter, userId);
 *     });
 *   });
 *
 *   server.listen(3000, () => {
 *     console.log("> Ready on http://localhost:3000");
 *   });
 *
 * ─── 生产部署说明 ──────────────────────────────────────────────
 * 生产环境需用 custom server 启动（不能用 `next start`）。
 * PM2 / Docker 部署时注意：
 *  - 单实例：本实现直接可用（进程内 EventEmitter 式广播）
 *  - 多实例：需引入 Redis Pub/Sub 跨实例广播（见 ws-server.ts 文件头注释）
 *  - Serverless（Vercel 等）：不支持 WebSocket，需改用 SSE 或托管 WebSocket 服务
 */