import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { verifyAccessToken, type JWTPayload } from "./jwt";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

/**
 * Better Auth 服务端实例（Spec §4：认证 = Better Auth）。
 * 负责：用户身份 + 会话（sessions/accounts/verifications 由 Better Auth 托管）。
 * 工作区上下文（wid 令牌 + RLS）由下方中间件单独处理（ADR-002）。
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    // Better Auth 默认生成 nanoid 格式 ID，与 Prisma @db.Uuid 不兼容。
    // 强制生成 PostgreSQL 兼容的 UUID v4。
    generateId: () => randomUUID(),
  },
});

// ─── 工作区上下文中间件（读取 wid 访问令牌，驱动 RLS）──

export interface AuthenticatedRequest extends NextRequest {
  auth?: JWTPayload;
}

export async function authenticate(req: NextRequest): Promise<JWTPayload | null> {
  // 优先从 httpOnly cookie 读取 access token（Web 端主路径，XSS 无法窃取）
  const cookieToken = req.cookies.get("access_token")?.value;
  if (cookieToken) {
    return verifyAccessToken(cookieToken);
  }
  // 回退到 Authorization Bearer header（保持 API 客户端兼容性）
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return verifyAccessToken(authHeader.slice(7));
  }
  return null;
}

export async function getWorkspaceContext(
  req: NextRequest,
  wid: string,
): Promise<{ payload: JWTPayload; member: { role: string; workspaceId: string } } | null> {
  const payload = await authenticate(req);
  if (!payload) return null;

  // 成员资格查询同样走 RLS 事务（注入 app.workspace_id / app.user_id）：
  // 即使未来对 members 表启用行级安全，这条路径也不会被策略误杀。
  const member = await runWithWorkspace(
    wid,
    (tx) =>
      tx.member.findFirst({
        where: { userId: payload.sub, workspaceId: wid },
        select: { role: true, workspaceId: true },
      }),
    payload.sub,
  );
  if (!member) return null;

  return { payload, member };
}

export function requireRole(allowed: string[]) {
  return function (req: NextRequest, context: { params: Promise<{ wid: string }> }) {
    return async () => {
      const ctx = await getWorkspaceContext(req, (await context.params).wid);
      if (!ctx) {
        return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
      }
      if (!allowed.includes(ctx.member.role)) {
        return NextResponse.json({ code: 403, message: "Forbidden" }, { status: 403 });
      }
      return null;
    };
  };
}

type Tx = Prisma.TransactionClient;

async function setGucs(tx: Tx, gucs: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(gucs)) {
    if (value === undefined) continue;
    await tx.$executeRawUnsafe(`SELECT set_config('app.${key}', $1, true)`, value);
  }
}

/**
 * 低层助手：在单个事务内注入任意 app.* GUC（事务结束自动复位）。
 * 业务代码请优先使用 runWithWorkspace / runWithAuthOp。
 */
export async function withGuc<T>(
  gucs: Record<string, string | undefined>,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setGucs(tx, gucs);
    return fn(tx);
  });
}

/**
 * 认证流程专用逃逸通道（login / provision / webhook）。
 * 对应 db/schema.sql 中各 RLS 策略的 `app.auth_op` 逃生口：
 * 这些流程发生在用户身份或工作区上下文建立之前/之外，策略按 op 白名单放行。
 */
export function runWithAuthOp<T>(
  op: "login" | "provision" | "webhook",
  fn: (tx: Tx) => Promise<T>,
  userId?: string,
): Promise<T> {
  return withGuc({ auth_op: op, user_id: userId }, fn);
}

/**
 * 在事务内注入 RLS 上下文：`SET LOCAL app.workspace_id = <wid>`，
 * 保证同一连接上的查询受行级安全策略约束（Spec §10 / AC-04）。
 * 所有工作区读写应经此 helper 包裹；能拿到 userId 时务必传入——
 * workspaces 表的策略按成员资格子查询 app.user_id 判定可见性。
 */
export async function runWithWorkspace<T>(
  wid: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  userId?: string,
): Promise<T> {
  return withGuc({ workspace_id: wid, user_id: userId }, fn);
}
