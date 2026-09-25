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

/** AI 服务未配置响应（503）
 *
 * code 对齐统一数字模式（原 "AI_NOT_CONFIGURED" 字符串违反 { code, data, message } 信封约定）。
 * 接受 req 参数以备国际化；apiMsg 暂无 aiNotConfigured key，先用硬编码英文。
 */
export function aiNotConfiguredResponse(_req: NextRequest): NextResponse {
  return NextResponse.json(
    { code: 503, message: "AI service is not configured", data: null },
    { status: 503 },
  );
}

/** 检查 AI 服务是否已配置（DEEPSEEK_API_KEY 或 OPENAI_API_KEY 任一存在且非空） */
export function isAiConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY || !!process.env.OPENAI_API_KEY;
}
/**
 * 获取当前用户 ID + 工作区 ID（用于 AI 使用量跟踪）。
 *
 * userId 优先 Better Auth session，回退到 JWT access_token（与 getUserId 一致）。
 * workspaceId 仅从 JWT payload.wid 获取（Better Auth session 不含 wid）；
 * 若 JWT 不存在（纯 Better Auth session 场景），workspaceId 为 null，
 * 调用方应跳过 usage tracking（AiUsageLog.workspaceId 为必填外键）。
 *
 * @returns { userId, workspaceId } 或 null（未认证）
 */
export async function getUserIdAndWorkspaceId(
  req: NextRequest,
): Promise<{ userId: string; workspaceId: string | null } | null> {
  const userId = await getUserId(req);
  if (!userId) return null;
  const payload = await authenticate(req);
  return { userId, workspaceId: payload?.wid ?? null };
}