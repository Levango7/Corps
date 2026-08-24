import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { verifyAccessToken, type JWTPayload } from "./jwt";
import { NextRequest } from "next/server";
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

type Tx = Prisma.TransactionClient;

// 审计 F-07/T3.7：GUC key 白名单映射到固定 SQL，杜绝 $executeRawUnsafe 拼接模式
const GUC_SQL: Record<string, string> = {
  auth_op: "SELECT set_config('app.auth_op', $1, true)",
  user_id: "SELECT set_config('app.user_id', $1, true)",
  workspace_id: "SELECT set_config('app.workspace_id', $1, true)",
};

async function setGucs(tx: Tx, gucs: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(gucs)) {
    if (value === undefined) continue;
    const sql = GUC_SQL[key];
    if (!sql) throw new Error(`未知的 RLS GUC key: ${key}`);
    await tx.$executeRawUnsafe(sql, value);
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
 * 认证流程专用逃逸通道（login / provision / webhook / invite）。
 * 对应 db/rls-activate.sql 中各 RLS 策略的 `app.auth_op` 逃生口：
 * 这些流程发生在用户身份或工作区上下文建立之前/之外，策略按 op 白名单放行。
 */
export function runWithAuthOp<T>(
  op: "login" | "provision" | "webhook" | "invite",
  fn: (tx: Tx) => Promise<T>,
  userId?: string,
): Promise<T> {
  return withGuc({ auth_op: op, user_id: userId }, fn);
}

/**
 * 席位记账专用上下文（审计 T1.2）：workspace_id + user_id + auth_op='seat' 三 GUC 齐备，
 * 允许对工作区行执行 SELECT ... FOR UPDATE（串行化并发邀请/接受，防席位超卖），
 * 同时保持其余表的常规租户隔离。仅用于邀请/接受流程的席位保护段。
 */
export function runWithSeatCheck<T>(
  wid: string,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withGuc({ workspace_id: wid, user_id: userId, auth_op: "seat" }, fn);
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
