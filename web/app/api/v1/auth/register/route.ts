import { NextRequest, NextResponse } from "next/server";
import { auth, runWithAuthOp } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { generateSlug } from "@/lib/slug";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { signAccessToken } from "@/lib/jwt";
import { createHash } from "crypto";

import { checkRateLimit } from "@/lib/rate-limit";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100).optional(),
  workspaceName: z.string().min(2).max(100),
  // P2-5：clientSessionId zod 校验 z.string().max(64)，
  // 对齐 events/route.ts eventSchema.sessionId 与 analytics_events.session_id varchar(64)。
  clientSessionId: z.string().max(64).optional(),
  // 邀请 token 上送（裁决四：signup 页读 ?invite= 并随 register 请求上送，
  // 服务端 sha256 查 invitations.tokenHash 归因 channel="invite"）
  inviteToken: z.string().max(256).optional(),
});

export async function POST(req: NextRequest) {
  // 限流：单 IP 每小时最多 10 次，防批量注册 / 垃圾账号
  const limited = await checkRateLimit(req, "register", { windowMs: 3_600_000, max: 10 });
  if (limited) return limited;

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
    const slug = await generateSlug(validated.workspaceName);
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

    // 4) P2 数据埋点：register_success 事件（不阻塞主流程，失败静默）
    //    props 一次成型（裁决四）：{ plan, seatLimit, channel, inviteWorkspaceId?, src?, sessionId? }
    //    channel 归因：inviteToken 命中 invitations.tokenHash → "invite"，否则 "organic"。
    //    token 明文不入 props（PII 红线），props 只存枚举与 wid。
    let channel: "organic" | "invite" = "organic";
    let inviteWorkspaceId: string | undefined;
    if (validated.inviteToken) {
      try {
        const tokenHash = createHash("sha256").update(validated.inviteToken).digest("hex");
        const invitation = await prisma.invitation.findUnique({
          where: { tokenHash },
          select: { workspaceId: true },
        });
        // 命中即归因，不校验 acceptedAt/expiresAt（受邀新用户注册发生在 accept 之前）
        if (invitation) {
          channel = "invite";
          inviteWorkspaceId = invitation.workspaceId;
        }
      } catch {
        // 归因查询失败不阻断注册主流程
      }
    }
    await trackServerEvent({
      userId: baUser.id,
      workspaceId: workspace.id,
      sessionId: validated.clientSessionId,
      name: "register_success",
      props: {
        plan: "free",
        seatLimit: 10,
        channel,
        ...(inviteWorkspaceId ? { inviteWorkspaceId } : {}),
        ...(validated.inviteToken ? { src: "invite" } : {}),
      },
    });

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
    // 统一通过原始 set-cookie 头下发（先 access_token 再透传 Better Auth 会话 cookie）。
    // 注意：不能混用 response.cookies.set()——其序列化会覆盖手工 append 的会话 cookie，
    // 导致 refresh 端点拿不到会话（401）。
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
    console.error("Register error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
