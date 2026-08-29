import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";
import {
  buildAuthorizeUrl,
  computeCodeChallenge,
  generateCodeVerifier,
  getProviderConfig,
  getProviderRedirectUri,
  signState,
  type CalendarProvider,
} from "@/lib/calendar/config";

/**
 * GET /api/v1/auth/calendar/connect/[provider]
 * 发起 OAuth2 授权：生成 PKCE + state，重定向到 provider 授权页面。
 *
 * 查询参数：
 *  - wid：回跳工作区 ID（授权完成后回到 /w/{wid}/settings/calendar）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;

  // 校验 provider
  try {
    getProviderConfig(provider);
  } catch {
    return NextResponse.json({ code: 400, message: "不支持的日历 provider" }, { status: 400 });
  }
  const p = provider as CalendarProvider;

  // 鉴权：必须登录
  const payload = await authenticate(req);
  if (!payload) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  // 读取回跳 wid（查询参数优先，缺省用 token 中的 wid）
  const url = new URL(req.url);
  const wid = url.searchParams.get("wid") ?? payload.wid;

  // 检查 provider 是否已配置 client_id
  const redirectUri = getProviderRedirectUri(p);
  try {
    // 生成 PKCE
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier);

    // 签名 state（含 userId + verifier + wid + nonce + iat）
    const state = signState({
      userId: payload.sub,
      verifier,
      wid,
      nonce: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
    });

    // 构造授权 URL 并重定向
    const authorizeUrl = buildAuthorizeUrl(p, { state, challenge, redirectUri });
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "授权发起失败";
    return NextResponse.json({ code: 500, message }, { status: 500 });
  }
}
