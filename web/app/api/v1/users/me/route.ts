import { NextRequest, NextResponse } from "next/server";
import { auth, authenticate } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// 复用同一份字段投影，保证 GET / PATCH 返回结构一致
const userSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

/**
 * 获取当前用户 ID：优先 Better Auth session，回退到 JWT access_token。
 * 两种认证方式都支持，确保 Bearer token 和 cookie 认证均可访问。
 */
async function getUserId(req: NextRequest): Promise<string | null> {
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

/**
 * GET /api/v1/users/me
 * 返回当前登录用户的个人资料。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
    if (!user) {
      return NextResponse.json({ code: 404, message: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ code: 200, data: user });
  } catch (error) {
    console.error("Get user error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  image: z.string().url().nullable().optional(),
});

/**
 * PATCH /api/v1/users/me
 * 更新当前登录用户的个人资料（name / image）。
 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await getUserId(req);
    if (!userId) {
      return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const data = updateSchema.parse(body);

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: userSelect,
    });
    return NextResponse.json({ code: 200, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 }
      );
    }
    console.error("Update user error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}