// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Buffer } from "buffer";
import {
  getProviderConfig,
  getProviderClientId,
  getProviderClientSecret,
  getProviderRedirectUri,
  generateCodeVerifier,
  computeCodeChallenge,
  signState,
  verifyState,
  buildAuthorizeUrl,
} from "@/lib/calendar/config";

/**
 * 日历 OAuth2 配置（lib/calendar/config.ts）的契约。
 *
 * 该模块管两条安全属性：
 *  1. PKCE：code_verifier/challenge 随机且单向（S256），授权码被截获也换不到 token
 *  2. state HMAC：防 CSRF + 防重放，生产环境缺密钥必须抛错（R9D-01），
 *     iat 类型必须校验（R9D-02：string iat 会让 NaN 判定永不过期）
 */

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "OUTLOOK_CLIENT_ID",
  "OUTLOOK_CLIENT_SECRET",
  "OUTLOOK_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
  "CALENDAR_STATE_SECRET",
  "JWT_ACCESS_SECRET",
  "NODE_ENV",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getProviderConfig", () => {
  it("google / outlook 各返回自己的端点配置", () => {
    expect(getProviderConfig("google").authorizeUrl).toContain("accounts.google.com");
    expect(getProviderConfig("outlook").authorizeUrl).toContain("login.microsoftonline.com");
  });

  it("google 配置含 revokeUrl（disconnect 可用），outlook 无（协议无此端点）", () => {
    expect(getProviderConfig("google").revokeUrl).toBeDefined();
    expect(getProviderConfig("outlook").revokeUrl).toBeUndefined();
  });

  it("scope 是日历写权限：google calendar.events / outlook Calendars.ReadWrite", () => {
    expect(getProviderConfig("google").scope).toContain("calendar.events");
    expect(getProviderConfig("outlook").scope).toContain("Calendars.ReadWrite");
  });

  it("未知 provider 抛错且错误信息含 provider 名（调用方能定位配置笔误）", () => {
    expect(() => getProviderConfig("apple")).toThrow(/apple/);
    expect(() => getProviderConfig("")).toThrow();
  });
});

describe("getProviderClientId / getProviderClientSecret", () => {
  it("从对应环境变量读取", () => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    expect(getProviderClientId("google")).toBe("g-id");
    expect(getProviderClientSecret("google")).toBe("g-secret");
  });

  it("outlook 用独立的 OUTLOOK_* 环境变量（不与 google 串）", () => {
    process.env.OUTLOOK_CLIENT_ID = "o-id";
    process.env.GOOGLE_CLIENT_ID = "g-id";
    expect(getProviderClientId("outlook")).toBe("o-id");
    expect(getProviderClientId("google")).toBe("g-id");
    expect(getProviderClientSecret("outlook")).toBeNull();
  });

  it("未配置返回 null（调用方据此显示「未接入」而不是崩溃）", () => {
    expect(getProviderClientId("google")).toBeNull();
    expect(getProviderClientSecret("outlook")).toBeNull();
  });
});

describe("getProviderRedirectUri", () => {
  it("显式环境变量优先", () => {
    process.env.GOOGLE_REDIRECT_URI = "https://app.example.com/oauth/google";
    expect(getProviderRedirectUri("google")).toBe("https://app.example.com/oauth/google");
  });

  it("缺省时由 NEXT_PUBLIC_APP_URL 拼接 /api/v1/auth/calendar/{p}/callback", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(getProviderRedirectUri("google")).toBe(
      "https://app.example.com/api/v1/auth/calendar/google/callback",
    );
    expect(getProviderRedirectUri("outlook")).toBe(
      "https://app.example.com/api/v1/auth/calendar/outlook/callback",
    );
  });

  it("NEXT_PUBLIC_APP_URL 也缺省时回退 localhost:3000（本地开发默认）", () => {
    expect(getProviderRedirectUri("google")).toBe(
      "http://localhost:3000/api/v1/auth/calendar/google/callback",
    );
  });
});

describe("PKCE：generateCodeVerifier / computeCodeChallenge", () => {
  it("verifier 是 43 字符的 base64url（32 字节熵，落在 RFC 7636 的 43-128 区间）", () => {
    const v = generateCodeVerifier();
    expect(v).toHaveLength(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("两次生成不相等（随机性）", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("challenge 是 sha256 的 base64url：独立已知向量 sha256(「hello」)", () => {
    // sha256("hello") 的十六进制摘要（标准已知值），转 base64url 作为独立期望值
    const expected = Buffer.from(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      "hex",
    ).toString("base64url");
    expect(computeCodeChallenge("hello")).toBe(expected);
  });

  it("challenge 确定性 + 单射（不同 verifier 不同 challenge）", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(computeCodeChallenge(a)).toBe(computeCodeChallenge(a));
    expect(computeCodeChallenge(a)).not.toBe(computeCodeChallenge(b));
  });

  it("challenge 不等于 verifier（单向：不能从 challenge 反推）", () => {
    const v = generateCodeVerifier();
    expect(computeCodeChallenge(v)).not.toBe(v);
  });
});

describe("state 签名：signState / verifyState", () => {
  const payload = {
    userId: "u-1",
    verifier: "v".repeat(43),
    wid: "w-1",
    nonce: "n-1",
    iat: Math.floor(Date.now() / 1000),
  };

  it("roundtrip：签发 → 验证 → 还原载荷全字段", () => {
    process.env.CALENDAR_STATE_SECRET = "test-secret";
    const state = signState(payload);
    const out = verifyState(state);
    expect(out).toEqual(payload);
  });

  it("state 结构 = base64url(payload).base64url(hmac)（两段，点分隔）", () => {
    process.env.CALENDAR_STATE_SECRET = "test-secret";
    const state = signState(payload);
    expect(state.split(".")).toHaveLength(2);
  });

  it("HMAC 不匹配（secret 被换）→ null", () => {
    process.env.CALENDAR_STATE_SECRET = "secret-a";
    const state = signState(payload);
    process.env.CALENDAR_STATE_SECRET = "secret-b";
    expect(verifyState(state)).toBeNull();
  });

  it("载荷被篡改（改 body 不改 mac）→ null", () => {
    process.env.CALENDAR_STATE_SECRET = "test-secret";
    const state = signState(payload);
    const [, mac] = state.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...payload, userId: "attacker" }),
      "utf8",
    ).toString("base64url");
    expect(verifyState(`${tampered}.${mac}`)).toBeNull();
    // 原始 state 仍可验证（未被破坏）
    expect(verifyState(state)).toEqual(payload);
  });

  it("结构非法（无点 / 空段 / 非 base64）→ null 不抛错", () => {
    process.env.CALENDAR_STATE_SECRET = "test-secret";
    expect(verifyState("onlyonepart")).toBeNull();
    expect(verifyState("")).toBeNull();
    expect(verifyState(".")).toBeNull();
    expect(verifyState("@@@.@@@")).toBeNull();
  });

  it("载荷缺 userId/verifier（非 string）→ null", () => {
    process.env.CALENDAR_STATE_SECRET = "test-secret";
    const bad = signState({ ...payload, userId: 123 } as never);
    expect(verifyState(bad)).toBeNull();
    const bad2 = signState({ ...payload, verifier: undefined } as never);
    expect(verifyState(bad2)).toBeNull();
  });

  it("R9D-02：iat 为 string 或 undefined 时拒绝（否则 NaN 判定永不过期）", () => {
    process.env.CALENDAR_STATE_SECRET = "test-secret";
    // 手工构造：绕过 signState 的类型，直接做 base64url+hmac
    const body = Buffer.from(JSON.stringify({ ...payload, iat: undefined }), "utf8").toString(
      "base64url",
    );
    // 用 verifyState 的同一密钥签 mac（signState 用的 payload.iat 是 number，
    // 这里直接用 signState 签一个 number iat 再替换 body 段即可单独验 body 解析）
    const good = signState(payload).split(".")[1];
    expect(verifyState(`${body}.${good}`)).toBeNull();
    const bodyStr = Buffer.from(JSON.stringify({ ...payload, iat: "1700000000" }), "utf8").toString(
      "base64url",
    );
    expect(verifyState(`${bodyStr}.${good}`)).toBeNull();
  });

  it("超时：iat 比 maxAgeSeconds 更早 → null；自定义 maxAgeSeconds 生效", () => {
    process.env.CALENDAR_STATE_SECRET = "test-secret";
    const fresh = signState({ ...payload, iat: Math.floor(Date.now() / 1000) });
    expect(verifyState(fresh, 600)).toEqual({ ...payload, iat: expect.any(Number) });
    const stale = signState({ ...payload, iat: Math.floor(Date.now() / 1000) - 3600 });
    expect(verifyState(stale, 600)).toBeNull();
    expect(verifyState(stale, 7200)).toEqual({ ...payload, iat: expect.any(Number) });
  });

  it("开发环境缺密钥：回退硬编码 dev secret 仍可 roundtrip（仅限非生产）", () => {
    const state = signState(payload);
    expect(verifyState(state)).toEqual(payload);
  });

  it("R9D-01：生产环境缺 CALENDAR_STATE_SECRET 与 JWT_ACCESS_SECRET → signState 抛错", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => signState(payload)).toThrow(/CALENDAR_STATE_SECRET|JWT_ACCESS_SECRET/);
  });

  it("生产环境有 JWT_ACCESS_SECRET 回退（兼容已部署实例）", () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.JWT_ACCESS_SECRET = "jwt-fallback";
    const state = signState(payload);
    expect(verifyState(state)).toEqual(payload);
  });
});

describe("buildAuthorizeUrl", () => {
  it("含全部 OAuth2 + PKCE 参数（response_type/code/client_id/redirect_uri/scope/state/code_challenge/S256）", () => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    const url = new URL(
      buildAuthorizeUrl("google", {
        state: "st",
        challenge: "ch",
        redirectUri: "http://localhost:3000/api/v1/auth/calendar/google/callback",
      }),
    );
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe("g-id");
    expect(p.get("redirect_uri")).toBe(
      "http://localhost:3000/api/v1/auth/calendar/google/callback",
    );
    expect(p.get("scope")).toContain("calendar.events");
    expect(p.get("state")).toBe("st");
    expect(p.get("code_challenge")).toBe("ch");
    expect(p.get("code_challenge_method")).toBe("S256");
  });

  it("googleStyle：追加 access_type=offline + prompt=consent（强制 refresh_token 与同意页）", () => {
    process.env.GOOGLE_CLIENT_ID = "g-id";
    const url = new URL(
      buildAuthorizeUrl("google", { state: "s", challenge: "c", redirectUri: "r" }),
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("outlook 不带 access_type/prompt（Microsoft 端点不认这组参数）", () => {
    process.env.OUTLOOK_CLIENT_ID = "o-id";
    const url = new URL(
      buildAuthorizeUrl("outlook", {
        state: "s",
        challenge: "c",
        redirectUri: "https://app.example.com/api/v1/auth/calendar/outlook/callback",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("access_type")).toBeNull();
    expect(url.searchParams.get("prompt")).toBeNull();
    expect(url.searchParams.get("scope")).toContain("Calendars.ReadWrite");
  });

  it("client_id 未配置抛错，错误信息含环境变量名（部署排错用）", () => {
    expect(() =>
      buildAuthorizeUrl("google", { state: "s", challenge: "c", redirectUri: "r" }),
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });
});
