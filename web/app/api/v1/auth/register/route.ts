import { NextRequest, NextResponse } from "next/server";
import { auth, runWithAuthOp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { signAccessToken } from "@/lib/jwt";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100).optional(),
  workspaceName: z.string().min(2).max(100),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = registerSchema.parse(body);

    const existingUser = await prisma.user.findUnique({
      where: { email: validated.email },
    });
    if (existingUser) {
      return NextResponse.json({ code: 409, message: "Email already registered" }, { status: 409 });
    }

    // 1) Better Auth 创建用户 + 会话（写入 cookie）
    const baRes = await auth.api.signUpEmail({
      body: {
        email: validated.email,
        password: validated.password,
        name: validated.name ?? validated.email.split("@")[0],
      },
      headers: req.headers,
      asResponse: true,
    });
    if (!baRes.ok) {
      const err = await baRes.json().catch(() => ({}));
      return NextResponse.json(err, { status: baRes.status });
    }
    const baBody = await baRes.json();
    const baUser = baBody.user;
    if (!baUser?.id) {
      return NextResponse.json(
        { code: 500, message: "Auth provider returned no user" },
        { status: 500 },
      );
    }

    // 2) 创建首个工作区 + owner 成员（单事务，走 provision 逃生口）
    const slug = validated.workspaceName.toLowerCase().replace(/\s+/g, "-").slice(0, 50);
    const { workspace } = await runWithAuthOp(
      "provision",
      async (tx) => {
        const ws = await tx.workspace.create({
          data: { name: validated.workspaceName, slug, ownerId: baUser.id },
        });
        await tx.member.create({
          data: { userId: baUser.id, workspaceId: ws.id, role: "owner" },
        });
        return { workspace: ws };
      },
      baUser.id,
    );

    // 3) 签发 workspace 作用域 wid 令牌（驱动 RLS）
    const accessToken = await signAccessToken({ sub: baUser.id, wid: workspace.id, role: "owner" });

    const response = NextResponse.json(
      {
        code: 201,
        data: {
          user: { id: baUser.id, email: baUser.email, name: baUser.name },
          workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },

        },
      },
      { status: 201 },
    );
    // 透传 Better Auth 会话 cookie
    baRes.headers.getSetCookie?.().forEach((c) => response.headers.append("set-cookie", c));
    // 下发 httpOnly access_token cookie（Web 端自动随请求发送，XSS 不可读）
    response.cookies.set("access_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15, // 15 分钟，与 JWT access token 过期一致
    });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("Register error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
