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
  wid: string
): Promise<{ payload: JWTPayload; member: { role: string; workspaceId: string } } | null> {
  const payload = await authenticate(req);
  if (!payload) return null;

  const member = await prisma.member.findFirst({
    where: { userId: payload.sub, workspaceId: wid },
    select: { role: true, workspaceId: true },
  });
  if (!member) return null;

  return { payload, member };
}

export function requireRole(allowed: string[]) {
  return function (req: NextRequest, context: { params: Promise<{ wid: string }> }) {
    return async () => {
      const { payload, member } = await getWorkspaceContext(req, (await context.params).wid);
      if (!member) {
        return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
      }
      if (!allowed.includes(member.role)) {
        return NextResponse.json({ code: 403, message: "Forbidden" }, { status: 403 });
      }
      return null;
    };
  };
}

/**
 * 在事务内注入 RLS 上下文：`SET LOCAL app.workspace_id = <wid>`，
 * 保证同一连接上的查询受行级安全策略约束（Spec §10 / AC-04）。
 * 所有工作区写读应经此 helper 包裹。
 */
export async function runWithWorkspace<T>(
  wid: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.workspace_id', $1, true)`, wid);
    return fn(tx);
  });
}
