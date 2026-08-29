/**
 * 日历集成：OAuth2 provider 配置 + PKCE 工具 + state 签名。
 *
 * 设计：
 *  - 支持的 provider：google | outlook
 *  - 授权码模式 + PKCE（S256）
 *  - state 用 HMAC 签名（防 CSRF），载荷含 userId + wid + PKCE verifier
 *  - token 端点配置由环境变量提供
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/** 支持的日历 provider */
export type CalendarProvider = "google" | "outlook";

/** OAuth2 端点配置 */
interface OAuthEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  /** 撤销 token 端点（可选，disconnect 时调用） */
  revokeUrl?: string;
  /** 用户信息端点（获取连接邮箱） */
  userinfoUrl: string;
  /** API 基础 URL */
  apiBaseUrl: string;
  /** OAuth scope */
  scope: string;
  /** 环境变量名：client_id / client_secret / redirect_uri */
  clientIdEnv: string;
  clientSecretEnv: string;
  redirectUriEnv: string;
  /** 是否在授权 URL 附加 Google 特有参数（access_type=offline & prompt=consent） */
  googleStyle: boolean;
}

/** Google Calendar OAuth2 配置（v2 端点） */
const GOOGLE_CONFIG: OAuthEndpoints = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  userinfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  apiBaseUrl: "https://www.googleapis.com/calendar/v3",
  scope: "https://www.googleapis.com/auth/calendar.events",
  clientIdEnv: "GOOGLE_CLIENT_ID",
  clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  redirectUriEnv: "GOOGLE_REDIRECT_URI",
  googleStyle: true,
};

/** Outlook Calendar OAuth2 配置（Microsoft v2.0 端点） */
const OUTLOOK_CONFIG: OAuthEndpoints = {
  authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  // Microsoft v2.0 端点无单独 revoke；disconnect 时直接删除本地记录
  userinfoUrl: "https://graph.microsoft.com/v1.0/me",
  apiBaseUrl: "https://graph.microsoft.com/v1.0",
  scope: "Calendars.ReadWrite offline_access",
  clientIdEnv: "OUTLOOK_CLIENT_ID",
  clientSecretEnv: "OUTLOOK_CLIENT_SECRET",
  redirectUriEnv: "OUTLOOK_REDIRECT_URI",
  googleStyle: false,
};

const PROVIDER_CONFIGS: Record<CalendarProvider, OAuthEndpoints> = {
  google: GOOGLE_CONFIG,
  outlook: OUTLOOK_CONFIG,
};

/** 获取 provider 配置（未知 provider 抛错） */
export function getProviderConfig(provider: string): OAuthEndpoints {
  if (provider !== "google" && provider !== "outlook") {
    throw new Error(`未知的日历 provider: ${provider}`);
  }
  return PROVIDER_CONFIGS[provider as CalendarProvider];
}

/** 读取 provider 的 client_id（未配置返回 null，调用方据此判断是否可用） */
export function getProviderClientId(provider: CalendarProvider): string | null {
  const cfg = PROVIDER_CONFIGS[provider];
  return process.env[cfg.clientIdEnv] ?? null;
}

/** 读取 provider 的 client_secret */
export function getProviderClientSecret(provider: CalendarProvider): string | null {
  const cfg = PROVIDER_CONFIGS[provider];
  return process.env[cfg.clientSecretEnv] ?? null;
}

/** 读取 provider 的 redirect_uri；缺省由 NEXT_PUBLIC_APP_URL 拼接 */
export function getProviderRedirectUri(provider: CalendarProvider): string {
  const cfg = PROVIDER_CONFIGS[provider];
  const explicit = process.env[cfg.redirectUriEnv];
  if (explicit) return explicit;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${appUrl}/api/v1/auth/calendar/${provider}/callback`;
}

// ─── PKCE 工具 ───────────────────────────────────────────────

/** 生成 PKCE code_verifier（43-128 字符的随机字符串） */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** 由 code_verifier 派生 code_challenge（S256 方法） */
export function computeCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ─── state 签名（HMAC-SHA256，防 CSRF）──────────────────────

const STATE_ENV_KEY = "CALENDAR_STATE_SECRET";

function getStateSecret(): string {
  const raw = process.env[STATE_ENV_KEY];
  if (raw) return raw;
  // 复用 JWT_ACCESS_SECRET 作为回退（开发环境）
  return process.env.JWT_ACCESS_SECRET ?? "dev-only-state-secret-do-not-use-in-prod";
}

/** state 载荷：userId + PKCE verifier + 回跳 wid */
export interface CalendarStatePayload {
  /** 发起授权的用户 ID */
  userId: string;
  /** PKCE code_verifier（回调时换 token 需要） */
  verifier: string;
  /** 回跳工作区 ID（授权完成后回到 /w/{wid}/settings/calendar） */
  wid: string;
  /** 防重放 nonce */
  nonce: string;
  /** 签发时间戳（秒） */
  iat: number;
}

/** 签名 state：返回 base64url(payload) + "." + base64url(hmac) */
export function signState(payload: CalendarStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", getStateSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** 验证 state 签名并解析载荷；签名不匹配或超时返回 null */
export function verifyState(state: string, maxAgeSeconds = 600): CalendarStatePayload | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", getStateSecret()).update(body).digest("base64url");
  // 常量时间比较防时序攻击
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as CalendarStatePayload;
    // 校验基本字段 + 时效
    if (typeof payload.userId !== "string" || typeof payload.verifier !== "string") return null;
    if (Date.now() / 1000 - payload.iat > maxAgeSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── 辅助：构造授权 URL ─────────────────────────────────────

/** 构造 OAuth2 授权 URL（含 PKCE + state） */
export function buildAuthorizeUrl(
  provider: CalendarProvider,
  opts: { state: string; challenge: string; redirectUri: string },
): string {
  const cfg = PROVIDER_CONFIGS[provider];
  const clientId = getProviderClientId(provider);
  if (!clientId) throw new Error(`${cfg.clientIdEnv} 未配置`);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    scope: cfg.scope,
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  // Google 特有参数：强制获取 refresh_token + 每次显示同意页
  if (cfg.googleStyle) {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  return `${cfg.authorizeUrl}?${params.toString()}`;
}
