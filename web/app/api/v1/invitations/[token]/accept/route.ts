import { NextRequest, NextResponse } from "next/server";
import { auth, authenticate, runWithAuthOp, runWithSeatCheck } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

/**
 * 获取当前用户 ID：优先 Better Auth session，回退到 JWT access_token。
 * 两种认证方式都支持，确保 Bearer token 和 cookie 认证均可访问
 * （与 users/me/route.ts 的 getUserId 同模式）。
 */
async function getUserId(req: NextRequest): Promise<{ id: string; email: string } | null> {
  // 1) 先尝试 Better Auth session（浏览器端主路径）
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session?.user?.id && session.user.email) {
      return { id: session.user.id, email: session.user.email };
    }
  } catch {
    // session 不存在或已过期，回退到 JWT
  }
  // 2) 回退到 JWT access_token（API 客户端 / curl 测试）
  const payload = await authenticate(req);
  if (!payload?.sub) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true },
  });
  return user ?? null;
}

/**
 * POST /api/v1/invitations/[token]/accept
 * 受邀人接受邀请：token 有效且登录邮箱与受邀邮箱一致时，
 * 在 RLS 事务内完成席位检查 → 建成员（或幂等复用已有成员身份）→ 标记已接受。
 * 注：invitations 表未启用 RLS，token 校验用 prisma 直查；成员写入走 RLS 事务。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const user = await getUserId(req);
  if (!user) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const { token } = await params;
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // 审计 T1.2：invitations 表已纳入 RLS，按 token 取邀请走受控 invite 逃生口
    const invitation = await runWithAuthOp("invite", (tx) =>
      tx.invitation.findUnique({
        where: { tokenHash },
        include: { workspace: { select: { id: true, name: true } } },
      }),
    );
    if (!invitation) {
      return NextResponse.json({ code: 404, message: "Invitation not found" }, { status: 404 });
    }
    if (invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return NextResponse.json(
        { code: 410, message: "该邀请已失效（已接受或已过期）" },
        { status: 410 },
      );
    }

    // 邮箱必须与当前登录用户完全一致（大小写不敏感），防止转发链接给他人顶替
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json(
        { code: 403, message: "请使用受邀邮箱注册/登录后再接受邀请" },
        { status: 403 },
      );
    }

    const wid = invitation.workspaceId;
    // 审计 T1.2：seat 上下文（wid+uid+op）允许 FOR UPDATE 锁定工作区行做席位串行化
    const result = await runWithSeatCheck(
      wid,
      user.id,
      async (tx) => {
        // SELECT FOR UPDATE 锁定 workspace 行，串行化并发接受事务（席位保护）
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${wid}::uuid FOR UPDATE`;

        const workspace = await tx.workspace.findUnique({ where: { id: wid } });
        const memberCount = await tx.member.count({ where: { workspaceId: wid } });

        // AC-08 席位上限：达 seatLimit 时拦截并提示升级
        if (workspace && memberCount >= workspace.seatLimit) {
          return { full: true as const };
        }

        // 已是成员则直接标记 accepted 并返回（幂等）
        const existing = await tx.member.findUnique({
          where: { userId_workspaceId: { userId: user.id, workspaceId: wid } },
        });

        let role: string;
        if (existing) {
          role = existing.role;
        } else {
          const member = await tx.member.create({
            data: {
              userId: user.id,
              workspaceId: wid,
              role: invitation.role,
              invitedBy: invitation.invitedBy,
            },
          });
          role = member.role;
        }

        // 标记邀请已被接受（一次性消费）
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });

        return { full: false as const, role };
      },
    );

    if (result.full) {
      return NextResponse.json(
        { code: 402, message: "席位已满，请联系工作区管理员升级套餐" },
        { status: 402 },
      );
    }

    return NextResponse.json({
      code: 200,
      data: { workspaceId: wid, workspaceName: invitation.workspace.name, role: result.role },
    });
  } catch (error) {
    console.error("[invitation accept] error:", error);
    return NextResponse.json({ code: 500, message: "服务器内部错误" }, { status: 500 });
  }
}
