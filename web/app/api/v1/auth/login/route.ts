import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { signAccessToken } from "@/lib/jwt";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = loginSchema.parse(body);

    const baRes = await auth.api.signInEmail({
      body: { email: validated.email, password: validated.password },
      headers: req.headers,
      asResponse: true,
    });
    if (!baRes.ok) {
      const err = await baRes.json().catch(() => ({ code: 401, message: "Invalid credentials" }));
      return NextResponse.json(err, { status: baRes.status });
    }
    const baBody = await baRes.json();
    const baUser = baBody.user;
    if (!baUser?.id) {
      return NextResponse.json({ code: 401, message: "Invalid credentials" }, { status: 401 });
    }

    // 解析工作区列表（含角色）
    const members = await prisma.member.findMany({
      where: { userId: baUser.id },
      include: { workspace: true },
    });
    const workspaces = members.map((m) => ({
      id: m.workspaceId,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
    }));

    const primary = workspaces[0];
    const accessToken = await signAccessToken({
      sub: baUser.id,
      wid: primary?.id || "",
      role: primary?.role || "member",
    });

    await prisma.user.update({ where: { id: baUser.id }, data: { lastLoginAt: new Date() } });

    const response = NextResponse.json({
      code: 200,
      data: { user: { id: baUser.id, email: baUser.email, name: baUser.name }, workspaces, accessToken },
    });
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
      return NextResponse.json({ code: 400, message: "Validation error", errors: error.errors }, { status: 400 });
    }
    console.error("Login error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
