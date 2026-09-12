import { NextRequest, NextResponse } from "next/server";
import { auth, authenticate } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * AI 路由共享认证与响应辅助。
 *
 * 认证策略与 /api/v1/users/me 同源：优先 Better Auth session（浏览器 cookie），
 * 回退到 JWT access_token（API 客户端 Bearer），保证两种调用方式均可访问。
 */

/**
 * 获取当前用户 ID：优先 Better Auth session，回退到 JWT access_token。
 */
export async function getUserId(req: NextRequest): Promise<string | null> {
  // 1) 先尝试 Better Auth session（浏览器端主路径）
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session?.user?.id) return session.user.id;
  } catch {
    // session 不存在或已过期，回退到 JWT
  }
  // 2) 回退到 JWT access_token（API 客户端 / curl 测试）
  const payload = await authenticate(req);
  return payload?.sub ?? null;
}

/** 未认证响应（401） */
export function unauthorizedResponse(req: NextRequest): NextResponse {
  return NextResponse.json(
    { code: 401, message: apiMsg(req, "unauthorized"), data: null },
    { status: 401 },
  );
}

/** AI 服务未配置响应（503） */
export function aiNotConfiguredResponse(): NextResponse {
  return NextResponse.json(
    { code: "AI_NOT_CONFIGURED", message: "AI service is not configured", data: null },
    { status: 503 },
  );
}

/** 检查 AI 服务是否已配置（DEEPSEEK_API_KEY 存在且非空） */
export function isAiConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}