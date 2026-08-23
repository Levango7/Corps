import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * POST /api/v1/auth/logout
 * 清除 Better Auth 会话 + httpOnly access_token cookie。
 * signOut 容错：即使 Better Auth session 已过期或不存在，也清除 cookie 并返回 200。
 */
export async function POST(req: NextRequest) {
  // 1) 尝试清除 Better Auth 服务端会话（失败不阻断 logout 流程）
  try {
    await auth.api.signOut({ headers: req.headers });
  } catch {
    // session 可能已过期/不存在，忽略错误，继续清除 cookie
  }

  // 2) 下发过期 access_token cookie，浏览器立即清除
  const response = NextResponse.json({ code: 200, data: null });
  response.cookies.set("access_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}