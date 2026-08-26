import { NextRequest, NextResponse } from "next/server";
import { auth, runWithAuthOp } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { prisma } from "@/lib/prisma";
import { signAccessToken } from "@/lib/jwt";
import { z } from "zod";

import { checkRateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(req: NextRequest) {
  // 限流：单 IP 每分钟最多 10 次，防撞库 / 暴力破解
  const limited = await checkRateLimit(req, "login", { windowMs: 60_000, max: 10 });
  if (limited) return limited;

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

    // 解析工作区列表（含角色）。走 RLS 事务：members 表若启用行级安全，
    // 依赖策略中的 app.auth_op='login' 逃生口（按 user_id 放行）。
    const members = await runWithAuthOp(
      "login",
      (tx) =>
        tx.member.findMany({
          where: { userId: baUser.id },
          include: { workspace: true },
        }),
      baUser.id,
    );
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

    // P2 数据埋点：login_success 事件（不阻塞主流程，失败静默）
    await trackServerEvent({
      userId: baUser.id,
      workspaceId: primary?.id ?? null,
      name: "login_success",
      props: { workspaceCount: workspaces.length },
    });

    const response = NextResponse.json({
      code: 200,
      data: {
        user: { id: baUser.id, email: baUser.email, name: baUser.name },
        workspaces,
      },
    });
    // 统一通过原始 set-cookie 头下发（先 access_token 再透传 Better Auth 会话 cookie）。
    // 不能混用 response.cookies.set()——会覆盖手工 append 的 BA 会话 cookie，
    // 导致 refresh 无法读取会话。
    const secureAttr = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
      "set-cookie",
      `access_token=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 15}${secureAttr}`,
    );
    baRes.headers.getSetCookie?.().forEach((c) => response.headers.append("set-cookie", c));
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("Login error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
