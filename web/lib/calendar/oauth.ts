/**
 * 日历集成：OAuth2 token 交换 + 用户信息获取的共享逻辑。
 * Google 和 Outlook 的 token 端点请求/响应格式基本一致（标准 OAuth2 授权码模式），
 * 差异在 userinfo 端点的响应结构，由各自 client 处理。
 */

import {
  type CalendarProvider,
  getProviderClientSecret,
  getProviderClientId,
  getProviderConfig,
  getProviderRedirectUri,
} from "./config";

/** OAuth2 token 端点响应（标准字段） */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // 秒
  token_type: string;
  scope?: string;
  id_token?: string;
}

/** 用授权码换 token（PKCE） */
export async function exchangeCodeForToken(
  provider: CalendarProvider,
  code: string,
  codeVerifier: string,
): Promise<OAuthTokenResponse> {
  const cfg = getProviderConfig(provider);
  const clientId = getProviderClientId(provider);
  const clientSecret = getProviderClientSecret(provider);
  if (!clientId) throw new Error(`${cfg.clientIdEnv} 未配置`);
  const redirectUri = getProviderRedirectUri(provider);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  // Outlook v2.0 端点要求 client_secret（机密客户端）；Google 也接受
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`token 交换失败 (${res.status}): ${errText}`);
  }
  const json = (await res.json()) as OAuthTokenResponse;
  if (!json.access_token) {
    throw new Error("token 响应缺少 access_token");
  }
  return json;
}

/** 用 refresh_token 刷新 access_token */
export async function refreshAccessToken(
  provider: CalendarProvider,
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const cfg = getProviderConfig(provider);
  const clientId = getProviderClientId(provider);
  const clientSecret = getProviderClientSecret(provider);
  if (!clientId) throw new Error(`${cfg.clientIdEnv} 未配置`);

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`token 刷新失败 (${res.status}): ${errText}`);
  }
  const json = (await res.json()) as OAuthTokenResponse;
  if (!json.access_token) {
    throw new Error("刷新响应缺少 access_token");
  }
  return json;
}

/** 撤销 token（仅 Google 提供撤销端点；Outlook 直接删本地记录） */
export async function revokeToken(provider: CalendarProvider, accessToken: string): Promise<void> {
  const cfg = getProviderConfig(provider);
  if (!cfg.revokeUrl) return;
  try {
    await fetch(`${cfg.revokeUrl}?token=${encodeURIComponent(accessToken)}`, { method: "POST" });
  } catch {
    // 撤销失败不阻塞本地记录删除
  }
}

/** Google userinfo 响应 */
export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email?: boolean;
}

/** Outlook /me 响应（含 mail 字段，部分账号 userPrincipalName 不同于 mail） */
export interface OutlookUserInfo {
  id: string;
  mail?: string;
  userPrincipalName?: string;
  displayName?: string;
}

/** 获取 Google 用户信息（邮箱） */
export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo 失败 (${res.status})`);
  }
  const json = (await res.json()) as GoogleUserInfo;
  if (!json.email) throw new Error("Google userinfo 缺少 email");
  return json;
}

/** 获取 Outlook 用户信息（邮箱） */
export async function fetchOutlookUserInfo(accessToken: string): Promise<OutlookUserInfo> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Outlook /me 失败 (${res.status})`);
  }
  const json = (await res.json()) as OutlookUserInfo;
  const email = json.mail ?? json.userPrincipalName;
  if (!email) throw new Error("Outlook /me 缺少 mail/userPrincipalName");
  return json;
}