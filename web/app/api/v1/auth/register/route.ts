import { NextRequest, NextResponse } from "next/server";
import { auth, runWithAuthOp } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { signAccessToken } from "@/lib/jwt";
import { randomUUID } from "crypto";

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
    // slug 仅保留 URL 安全字符；中文名等清洗后为空时回退到 "ws"
    const baseSlug =
      validated.workspaceName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "ws";
    const { workspace } = await runWithAuthOp(
      "provision",
      async (tx) => {
        // slug 有全局唯一约束：冲突时追加短随机后缀，最多重试 5 次；
        // 并发窗口内的残余碰撞由 DB unique 约束兜底（事务整体回滚，前端可安全重试）
        let slug = baseSlug;
        for (let attempt = 0; attempt < 5; attempt++) {
          const exists = await tx.workspace.findUnique({
            where: { slug },
            select: { id: true },
          });
          if (!exists) break;
          slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
        }
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
    await prisma.analyticsEvent
      .create({
        data: {
          id: randomUUID(),
          userId: baUser.id,
          workspaceId: workspace.id,
          name: "register_success",
          props: { plan: "free", seatLimit: 10 },
        },
      })
      .catch(() => {
        /* 埋点失败不影响注册主流程 */
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
