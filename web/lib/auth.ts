import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";
import { verifyAccessToken, type JWTPayload } from "./jwt";
import { sendResetPasswordEmail } from "./email";
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
    // 忘记密码：better-auth 负责 token 生成/校验（/api/auth/request-password-reset、
    // /api/auth/reset-password），本回调只负责把一次性链接发出去。
    // 自建链接指向 /auth/reset-password（站内页），不用 better-auth 默认的 /reset-password 路径
    sendResetPassword: async ({ user, token }) => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      await sendResetPasswordEmail({
        to: user.email,
        resetUrl: `${appUrl}/auth/reset-password?token=${token}`,
      });
    },
    resetPasswordTokenExpiresIn: 60 * 60, // 1 小时
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    // Better Auth 1.7.1 从 advanced.database.generateId 读取 ID 生成器（非 advanced.generateId）。
    // 默认 nanoid 格式 ID 与 Prisma @db.Uuid 不兼容（P2023 invalid UUID），
    // 强制生成 PostgreSQL 兼容的 UUID v4。
    database: {
      generateId: () => randomUUID(),
    },
  },
  // T2.5：Better Auth 内置限流（login/register/refresh 等端点）
  rateLimit: {
    enabled: process.env.RATE_LIMIT_DISABLED !== "1",
    window: 60, // 60 秒窗口
    max: 10, // 每窗口最多 10 次请求
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

  // wid 守卫：token 签发时绑定了工作区（login 后的 access token 均带 wid），
  // URL wid 与之不一致即拒绝（防 token 被拿去访问另一工作区的端点——成员
  // 查询本身会被 RLS 拦，但这里在打开任何事务前短路，零 DB 副作用）。
  // 旧 token / Bearer 场景可能不带 wid，跳过守卫走正常成员资格校验。
  if (payload.wid && payload.wid !== wid) return null;

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
  public_token: "SELECT set_config('app.public_token', $1, true)",
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
  // 交互式事务独占一个池连接。Prisma 默认 maxWait=2000ms 在并发请求
  // 集中、连接池需渐进建立新连接时会过早超时（P2028，见 __prisma_pool_conc.cjs
  // 实测：并发 8 事务约需 2.4s 才能全部拿到连接）。显式放宽 maxWait 与
  // timeout，保证高并发下事务能排队拿到连接而非直接失败。
  return prisma.$transaction(
    async (tx) => {
      await setGucs(tx, gucs);
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/**
 * 认证/系统作业专用逃逸通道（login / provision / webhook / invite / cron / calendar）。
 * 对应 db/rls-activate.sql 中各 RLS 策略的 `app.auth_op` 逃生口：
 * 这些流程发生在用户身份或工作区上下文建立之前/之外，策略按 op 白名单放行。
 * cron/calendar 仅供跨工作区只读扫描类系统作业（截止日提醒 / 日历同步）。
 */
export function runWithAuthOp<T>(
  op: "login" | "provision" | "webhook" | "invite" | "cron" | "calendar",
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

/**
 * 在已开启的 GUC 事务内追加注入 GUC（事务结束自动复位）。
 * 用于上下文取决于事务内先读出的数据行的场景——如公开分享流：先凭 token 读出
 * 文档行，再按行上的 workspace_id 放行工作区行的读取。key 仍受 GUC_SQL 白名单约束。
 */
export async function setTxGuc(tx: Tx, key: string, value: string): Promise<void> {
  const sql = GUC_SQL[key];
  if (!sql) throw new Error(`未知的 RLS GUC key: ${key}`);
  await tx.$executeRawUnsafe(sql, value);
}

/**
 * 公开分享文档只读上下文：把 URL 中的 share_token 注入 app.public_token，
 * documents 表的 p_documents_share_select 策略仅放行 token 相等的行
 * （FORCE RLS 不绕过，NULL token 永不匹配）。仅限 /api/documents/share/[token]
 * 公开读路径使用，无写入能力。
 */
export function runWithShareToken<T>(
  token: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withGuc({ public_token: token }, fn);
}
