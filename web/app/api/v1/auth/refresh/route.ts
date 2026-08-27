import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID } from "crypto";
import { auth, runWithAuthOp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { signAccessToken } from "@/lib/jwt";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";

const refreshSchema = z.object({ workspaceId: z.string().uuid().optional() });

/** session cookie 有效期：7 天，与 lib/auth.ts 的 session.expiresIn 一致 */
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Better Auth 会话 cookie 名称。
 *
 * 命名依据（better-auth 1.7.1 dist/cookies/index.mjs）：
 *  - cookiePrefix 默认 `better-auth`，会话 cookie 名 `session_token`，
 *    即开发环境 `better-auth.session_token`；
 *  - advanced.useSecureCookies 为 true（本项目配置为 NODE_ENV==="production"）时
 *    附加 `__Secure-` 前缀，即生产环境 `__Secure-better-auth.session_token`。
 *
 * 【升级核对点】手动轮换依赖该命名规则；升级 better-auth 版本时必须核对其
 * dist/cookies/index.mjs 中 prefix/secure 前缀逻辑是否变化。
 */
function sessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Secure-better-auth.session_token"
    : "better-auth.session_token";
}

/**
 * 复刻 better-call（better-auth 1.7.1 的签名依赖）的签名 cookie 值编码。
 *
 * better-auth 的 get-session 端点不直接信任 cookie 裸值，而是经
 * better-call 的 `getSignedCookie` 验签（node_modules 实读确认）：
 *  - better-call dist/crypto.mjs `makeSignature`：
 *    WebCrypto HMAC-SHA256，key = secret 的 UTF-8 字节，message = 值 UTF-8 字节，
 *    签名 = btoa(字节) → 标准 Base64（带 padding，32 字节摘要固定 44 字符、以 "=" 结尾）；
 *  - better-call dist/cookies.mjs `signCookieValue`：
 *    最终值 = encodeURIComponent(`${value}.${signature}`)；
 *  - better-call dist/context.mjs `getSignedCookie`（验签侧）：
 *    cookie 解析并 URL 解码后按最后一个 "." 分割，严格要求签名长度 44 且以 "=" 结尾，
 *    再 HMAC 验签，通过才返回 token 供 DB 查询 session。
 *
 * 因此手动轮换必须下发签名格式 `token.HMAC签名`——下发裸 token 会验签失败 →
 * 会话丢失（TC-AUTH-05 回归失败的根因）。本函数只产出编码前的
 * `${token}.${signature}`，Next.js `response.cookies.set` 序列化 Set-Cookie 时
 * 自动百分号编码，与 better-call 的 encodeURIComponent 等价。
 *
 * 签名密钥 = BETTER_AUTH_SECRET：lib/auth.ts 未显式配置 betterAuth({ secret })，
 * better-auth 运行时从该环境变量取密钥，与 better-call 验签使用同一 secret。
 *
 * 【升级核对点】升级 better-auth / better-call 时必须重新核对该签名算法
 * （better-call dist/crypto.mjs signCookieValue 与 dist/context.mjs getSignedCookie），
 * 否则轮换 cookie 验签失败 → 全线 401。
 */
function signSessionCookieValue(token: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    // 缺少 secret 时 better-auth 自身也无法签发/验证会话 cookie；
    // 宁可显式失败（外层 catch → 500），不可静默下发注定验签失败的裸 token。
    throw new Error("BETTER_AUTH_SECRET is not set; cannot sign session cookie");
  }
  const signature = createHmac("sha256", secret).update(token, "utf8").digest("base64");
  return `${token}.${signature}`;
}

export async function POST(req: NextRequest) {
  // 限流：单 IP 每分钟最多 60 次（正常前端轮换频率远低于此，仅拦异常刷接口）
  const limited = await checkRateLimit(req, "refresh", { windowMs: 60_000, max: 60 });
  if (limited) return limited;

  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ code: 401, message: "No active session" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { workspaceId } = refreshSchema.parse(body);

    const members = await runWithAuthOp(
      "login",
      (tx) =>
        tx.member.findMany({
          where: { userId: session.user.id },
          include: { workspace: true },
        }),
      session.user.id,
    );
    if (members.length === 0) {
      return NextResponse.json({ code: 401, message: "No workspace" }, { status: 401 });
    }

    const target = members.find((m) => m.workspaceId === workspaceId) ?? members[0];

    // ── TC-AUTH-05 修复：session token 一次性轮换 ──────────────────────────
    // Better Auth 1.7.1 无内置 session 轮换 API（node_modules 检索确认），手动实现：
    // 覆写 DB 中 session.token → 经 Set-Cookie 下发新 token 的签名格式，
    // 旧 token 在覆写瞬间失效，被盗 session cookie 无法在 7 天有效期内无限续期 access token。
    //
    // 【签名格式】cookie 值必须是 better-call 签名格式 `新token.HMAC签名`
    // （见 signSessionCookieValue 注释），裸 token 会被 getSignedCookie 验签拒绝 → 401。
    //
    // sessions 表不在 RLS 管辖范围（db/rls-activate.sql 仅对业务域启用，
    // 身份域由 Better Auth 托管），prisma 直连更新不受策略阻塞。
    //
    // 仅放在所有校验（会话有效、成员存在）通过之后：失败分支不产生轮换副作用，
    // 避免 401/400 路径覆写 token 后客户端旧 cookie 失效导致会话不可达。
    //
    // 已知竞态（按修复方案接受，不设宽限期）：多标签页并发 refresh 的窄窗口内，
    // 后到请求持旧 token 将收到 401；前端 lib/api.ts 的 401 单次重试机制可自愈。
    const newSessionToken = randomUUID();
    // 先签名后写 DB：签名环境异常（如缺 BETTER_AUTH_SECRET）时快速失败且无副作用，
    // 避免 DB token 已轮换但客户端拿不到可验签 cookie → 会话不可达。
    const signedSessionCookieValue = signSessionCookieValue(newSessionToken);
    await prisma.session.update({
      where: { id: session.session.id },
      data: { token: newSessionToken },
    });

    const accessToken = await signAccessToken({
      sub: session.user.id,
      wid: target.workspaceId,
      role: target.role,
    });

    const response = NextResponse.json({
      code: 200,
      data: {
        workspace: { id: target.workspaceId, name: target.workspace.name, role: target.role },
      },
    });
    // 下发 httpOnly access_token cookie（Web 端自动随请求发送，XSS 不可读）
    response.cookies.set("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15, // 15 分钟，与 JWT access token 过期时间一致
    });
    // 下发轮换后的 session token cookie：名称/属性与 Better Auth 自身写入的
    // session cookie 完全一致（见 sessionCookieName 注释），值为签名格式
    //（见 signSessionCookieValue 注释），浏览器将以新值覆盖旧值
    response.cookies.set(sessionCookieName(), signedSessionCookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("Refresh error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
