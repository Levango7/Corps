import { NextRequest, NextResponse } from "next/server";
import { auth, runWithAuthOp } from "@/lib/auth";
import { signAccessToken } from "@/lib/jwt";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";

const refreshSchema = z.object({ workspaceId: z.string().uuid().optional() });

export async function POST(req: NextRequest) {
  // 限流：单 IP 每分钟最多 60 次（正常前端轮换频率远低于此，仅拦异常刷接口）
  const limited = await checkRateLimit(req, "refresh", { windowMs: 60_000, max: 60 });
  if (limited) return limited;

  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ code: 401, message: "No active session" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { workspaceId } = refreshSchema.parse(body);

    const members = await runWithAuthOp(
      "login",
      (tx) =>
        tx.member.findMany({
          where: { userId: session.user.id },
          include: { workspace: true },
        }),
      session.user.id,
    );
    if (members.length === 0) {
      return NextResponse.json({ code: 401, message: "No workspace" }, { status: 401 });
    }

    const target = members.find((m) => m.workspaceId === workspaceId) ?? members[0];
    const accessToken = await signAccessToken({
      sub: session.user.id,
      wid: target.workspaceId,
      role: target.role,
    });

    const response = NextResponse.json({
      code: 200,
      data: {

        workspace: { id: target.workspaceId, name: target.workspace.name, role: target.role },
      },
    });
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
    console.error("Refresh error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
