import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * refresh 端点 session token 一次性轮换单元测试（TC-AUTH-05 修复回归）
 *
 * 覆盖 app/api/v1/auth/refresh/route.ts 的轮换核心逻辑（纯单元级，不依赖
 * 3000 服务与真实 DB——依赖模块全部 mock）：
 *  - 成功分支：prisma.session.update 以新 token 覆写原 session，
 *    且 Set-Cookie 下发同名新 session token（token 值与 DB 写入一致）
 *  - cookie 命名两态：开发 `better-auth.session_token` /
 *    生产 `__Secure-better-auth.session_token`（含 Secure 属性）
 *  - cookie 属性对齐 better-auth 自身写入（httpOnly/sameSite=lax/path=//maxAge=7d）
 *  - cookie 值必须为 better-call 签名格式 `token.HMAC-SHA256(token, secret)`
 *    （标准 Base64、44 字符、"=" 结尾）——裸 token 会被 getSignedCookie 验签
 *    拒绝导致 401（TC-AUTH-05 集成失败根因，签名算法等价性独立复算验证）
 *  - BETTER_AUTH_SECRET 缺失时快速失败 500，绝不静默下发裸 token
 *  - 失败分支（无会话 / 无工作区 / 参数非法）一律不产生轮换副作用（不调用 update）
 *
 * 旧 token 失效的 DB 端行为（better-auth getSession 找不到旧 token → 401）
 * 属端到端语义，由 tests/integration/auth-flow.test.ts 的 TC-AUTH-05 集成用例覆盖。
 */

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => null), // 限流放行，聚焦轮换逻辑
}));

vi.mock("@/lib/jwt", () => ({
  signAccessToken: vi.fn(async () => "mock-access-jwt"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { update: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn() } },
  runWithAuthOp: vi.fn(),
}));

import { createHmac } from "crypto";
import { POST } from "@/app/api/v1/auth/refresh/route";
import { auth, runWithAuthOp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000003";
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
/** 测试用 BETTER_AUTH_SECRET（与生产值格式一致：64 位 hex） */
const TEST_SECRET = "test-secret-0123456789abcdef0123456789abcdef0123456789abcdef0123";

const VALID_SESSION = {
  session: { id: SESSION_ID, token: "old-session-token", userId: USER_ID },
  user: { id: USER_ID, email: "u@corps.test" },
};

const VALID_MEMBERS = [
  { workspaceId: WORKSPACE_ID, role: "owner", workspace: { id: WORKSPACE_ID, name: "WS" } },
];

/** 构造带 session cookie 的 refresh 请求 */
function makeRequest(body: unknown = {}): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "better-auth.session_token=old-session-token",
    },
    body: JSON.stringify(body),
  });
}

/** 从响应中提取指定名称的 Set-Cookie 原始串 */
function setCookieOf(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie?.().find((c) => c.startsWith(`${name}=`));
}

/** 提取 Set-Cookie 的 value 段（首个 ";" 之前）并 URL 解码（与 better-call parseCookies 的 tryDecode 对齐） */
function cookieValueOf(res: Response, name: string): string | undefined {
  const raw = setCookieOf(res, name);
  if (!raw) return undefined;
  const value = raw.slice(name.length + 1).split(";")[0];
  return decodeURIComponent(value);
}

beforeEach(() => {
  vi.mocked(auth.api.getSession).mockReset();
  vi.mocked(runWithAuthOp).mockReset();
  vi.mocked(prisma.session.update).mockReset();
  vi.mocked(prisma.session.update).mockResolvedValue({} as never);
  vi.mocked(runWithAuthOp).mockResolvedValue(VALID_MEMBERS as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("refresh 轮换 - 成功分支（开发环境）", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BETTER_AUTH_SECRET", TEST_SECRET);
    vi.mocked(auth.api.getSession).mockResolvedValue(VALID_SESSION as never);
  });

  it("以新 token 覆写 DB 中的 session（where=id，data.token=新值）", async () => {
    // Act
    const res = await POST(makeRequest());

    // Assert
    expect(res.status).toBe(200);
    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.session.update).mock.calls[0][0];
    expect(arg.where).toEqual({ id: SESSION_ID });
    expect(typeof arg.data.token).toBe("string");
    expect((arg.data.token as string).length).toBeGreaterThan(10); // UUID 级长度
    expect(arg.data.token).not.toBe("old-session-token"); // 确实发生了覆写
  });

  it("Set-Cookie 下发 better-auth.session_token，值与 DB 写入一致", async () => {
    // Act
    const res = await POST(makeRequest());

    // Assert
    const written = vi.mocked(prisma.session.update).mock.calls[0][0].data.token as string;
    const cookie = setCookieOf(res, "better-auth.session_token");
    expect(cookie).toBeDefined();
    expect(cookie).toContain(written);
    // 开发环境不应下发 __Secure- 前缀版本
    expect(setCookieOf(res, "__Secure-better-auth.session_token")).toBeUndefined();
  });

  it("session cookie 属性与 better-auth 自身写入一致", async () => {
    // Act
    const res = await POST(makeRequest());

    // Assert（属性对照 better-auth 1.7.1 dist/cookies/index.mjs createCookie 默认值）
    const cookie = setCookieOf(res, "better-auth.session_token")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(new RegExp(`Max-Age=${SEVEN_DAYS_SECONDS}`, "i"));
    expect(cookie).not.toMatch(/Secure/i); // 开发环境不带 Secure
  });

  it("access_token JWT cookie 逻辑保持不变（同响应一并下发）", async () => {
    // Act
    const res = await POST(makeRequest());

    // Assert
    const accessTokenCookie = setCookieOf(res, "access_token");
    expect(accessTokenCookie).toBeDefined();
    expect(accessTokenCookie).toContain("mock-access-jwt");
    expect(accessTokenCookie).toMatch(/HttpOnly/i);
    expect(accessTokenCookie).toMatch(/Max-Age=900/i); // 15 分钟
  });
});

describe("refresh 轮换 - 成功分支（生产环境）", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", TEST_SECRET);
    vi.mocked(auth.api.getSession).mockResolvedValue(VALID_SESSION as never);
  });

  it("生产环境 cookie 名为 __Secure-better-auth.session_token 且带 Secure 属性", async () => {
    // Act
    const res = await POST(makeRequest());

    // Assert
    expect(res.status).toBe(200);
    const written = vi.mocked(prisma.session.update).mock.calls[0][0].data.token as string;
    const cookie = setCookieOf(res, "__Secure-better-auth.session_token");
    expect(cookie).toBeDefined();
    expect(cookie).toContain(written);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    // 生产环境不下发无前缀版本
    expect(setCookieOf(res, "better-auth.session_token")).toBeUndefined();
  });
});

describe("refresh 轮换 - 签名 cookie 格式（对齐 better-call 验签语义）", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BETTER_AUTH_SECRET", TEST_SECRET);
    vi.mocked(auth.api.getSession).mockResolvedValue(VALID_SESSION as never);
  });

  it("cookie 值为 `新token.HMAC签名` 格式，token 段与 DB 写入一致", async () => {
    // Act
    const res = await POST(makeRequest());

    // Assert
    const written = vi.mocked(prisma.session.update).mock.calls[0][0].data.token as string;
    const value = cookieValueOf(res, "better-auth.session_token");
    expect(value).toBeDefined();
    const dotPos = value!.lastIndexOf(".");
    expect(dotPos).toBeGreaterThanOrEqual(1);
    // token 段即 DB 覆写值（裸 token 存 DB，签名仅存在于 cookie）
    expect(value!.substring(0, dotPos)).toBe(written);
  });

  it("签名 = Base64(HMAC-SHA256(token, BETTER_AUTH_SECRET))，满足 better-call 严格校验（44 字符、'=' 结尾）", async () => {
    // Arrange：按 better-call dist/context.mjs getSignedCookie 的验签规则独立复算
    //（算法依据 better-call dist/crypto.mjs makeSignature：HMAC-SHA256 + btoa 标准 Base64）
    const res = await POST(makeRequest());
    const written = vi.mocked(prisma.session.update).mock.calls[0][0].data.token as string;

    // Act
    const value = cookieValueOf(res, "better-auth.session_token")!;
    const signature = value.substring(value.lastIndexOf(".") + 1);

    // Assert：better-call 验签前置强校验（context.mjs L47：签名长度 !== 44 或不以 "=" 结尾 → null）
    expect(signature).toHaveLength(44);
    expect(signature.endsWith("=")).toBe(true);
    // 独立复算签名并恒等比对
    const expected = createHmac("sha256", TEST_SECRET).update(written, "utf8").digest("base64");
    expect(signature).toBe(expected);
  });

  it("签名对其他密钥不可伪造验证（HMAC 完整性语义）", async () => {
    // Act
    const res = await POST(makeRequest());
    const written = vi.mocked(prisma.session.update).mock.calls[0][0].data.token as string;
    const value = cookieValueOf(res, "better-auth.session_token")!;
    const signature = value.substring(value.lastIndexOf(".") + 1);
    const forged = createHmac("sha256", "another-secret").update(written, "utf8").digest("base64");

    // Assert
    expect(signature).not.toBe(forged);
  });

  it("缺少 BETTER_AUTH_SECRET → 500 快速失败：不写 DB、不下发 session cookie（无轮换副作用）", async () => {
    // Arrange
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    // Act
    const res = await POST(makeRequest());

    // Assert
    expect(res.status).toBe(500);
    expect(prisma.session.update).not.toHaveBeenCalled();
    expect(setCookieOf(res, "better-auth.session_token")).toBeUndefined();
  });
});

describe("refresh 轮换 - 失败分支无轮换副作用", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
  });

  it("无有效会话 → 401，不调用 session.update", async () => {
    // Arrange
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    // Act
    const res = await POST(makeRequest());

    // Assert
    expect(res.status).toBe(401);
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it("用户无任何工作区成员 → 401，不调用 session.update", async () => {
    // Arrange
    vi.mocked(auth.api.getSession).mockResolvedValue(VALID_SESSION as never);
    vi.mocked(runWithAuthOp).mockResolvedValue([] as never);

    // Act
    const res = await POST(makeRequest());

    // Assert
    expect(res.status).toBe(401);
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it("workspaceId 非 UUID → 400，不调用 session.update", async () => {
    // Arrange
    vi.mocked(auth.api.getSession).mockResolvedValue(VALID_SESSION as never);

    // Act
    const res = await POST(makeRequest({ workspaceId: "not-a-uuid" }));

    // Assert
    expect(res.status).toBe(400);
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});
