import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { verifyState, type CalendarProvider } from "@/lib/calendar/config";
import {
  exchangeCodeForToken,
  fetchGoogleUserInfo,
  fetchOutlookUserInfo,
} from "@/lib/calendar/oauth";
import { getPrimaryCalendarId as getGooglePrimaryCalendarId } from "@/lib/calendar/google-client";
import { getPrimaryCalendarId as getOutlookPrimaryCalendarId } from "@/lib/calendar/outlook-client";

/**
 * GET /api/v1/auth/calendar/[provider]/callback
 * OAuth2 回调：用 code 换 token，获取用户邮箱 + 默认日历 ID，存储 CalendarConnection。
 *
 * 流程：
 *  1. 校验 state 签名（防 CSRF）+ 提取 PKCE verifier + userId + wid
 *  2. 用 code + verifier 换 access_token / refresh_token
 *  3. 获取用户邮箱（provider userinfo 端点）
 *  4. 获取默认日历 ID
 *  5. 加密存储 token，upsert CalendarConnection（同 userId+provider 唯一）
 *  6. 重定向回 /w/{wid}/settings/calendar
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // OAuth provider 返回的 error（用户拒绝授权等）
  if (errorParam) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return NextResponse.redirect(
      `${appUrl}/settings/calendar?error=${encodeURIComponent(errorParam)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.json({ code: 400, message: "缺少 code 或 state 参数" }, { status: 400 });
  }

  // 校验 provider
  if (provider !== "google" && provider !== "outlook") {
    return NextResponse.json({ code: 400, message: "不支持的日历 provider" }, { status: 400 });
  }
  const p = provider as CalendarProvider;

  // 验证 state 签名 + 提取载荷
  const statePayload = verifyState(state);
  if (!statePayload) {
    return NextResponse.json({ code: 400, message: "state 验证失败" }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectTarget = `${appUrl}/w/${statePayload.wid}/settings/calendar`;

  try {
    // 1. 用 code + verifier 换 token
    const tokenRes = await exchangeCodeForToken(p, code, statePayload.verifier);
    if (!tokenRes.refresh_token) {
      return NextResponse.redirect(
        `${redirectTarget}?error=${encodeURIComponent("未获取到 refresh_token，请重新授权")}`,
      );
    }

    // 2. 获取用户邮箱 + 默认日历 ID
    let email: string;
    let calendarId: string;
    if (p === "google") {
      const userInfo = await fetchGoogleUserInfo(tokenRes.access_token);
      email = userInfo.email;
      calendarId = await getGooglePrimaryCalendarId(tokenRes.access_token);
    } else {
      const userInfo = await fetchOutlookUserInfo(tokenRes.access_token);
      email = userInfo.mail ?? userInfo.userPrincipalName ?? "";
      calendarId = await getOutlookPrimaryCalendarId(tokenRes.access_token);
    }

    // 3. 加密存储 token，upsert 连接记录
    const tokenExpiresAt = new Date(Date.now() + tokenRes.expires_in * 1000);
    await prisma.calendarConnection.upsert({
      where: {
        userId_provider: { userId: statePayload.userId, provider: p },
      },
      create: {
        userId: statePayload.userId,
        provider: p,
        email,
        accessToken: encrypt(tokenRes.access_token),
        refreshToken: encrypt(tokenRes.refresh_token),
        tokenExpiresAt,
        calendarId,
      },
      update: {
        email,
        accessToken: encrypt(tokenRes.access_token),
        refreshToken: encrypt(tokenRes.refresh_token),
        tokenExpiresAt,
        calendarId,
        syncStatus: "idle",
        syncError: null,
      },
    });

    // 4. 重定向回设置页（带 success 标记）
    return NextResponse.redirect(`${redirectTarget}?connected=${p}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "授权回调失败";
    return NextResponse.redirect(`${redirectTarget}?error=${encodeURIComponent(message)}`);
  }
}
