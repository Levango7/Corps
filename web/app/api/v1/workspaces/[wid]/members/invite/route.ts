import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { z } from "zod";
import { randomUUID } from "crypto";

const inviteSchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: "Only owner/admin can invite" },
      { status: 403 },
    );
  }

  try {
    const { email } = inviteSchema.parse(await req.json());

    const invitedUser = await prisma.user.findUnique({ where: { email } });
    if (!invitedUser) {
      // MVP：受邀人需已有 corps 账户（闭环 beta）。未注册返回明确提示。
      return NextResponse.json(
        { code: 422, message: "该邮箱尚未注册 corps，请先邀请对方注册" },
        { status: 422 },
      );
    }

    // 席位检查 + 建成员在同一 RLS 事务内完成，避免并发邀请绕过 seatLimit
    const result = await runWithWorkspace(
      wid,
      async (tx) => {
        // A-6: SELECT FOR UPDATE 锁定 workspace 行，串行化并发邀请事务，
        // 避免两个事务同时读到 memberCount < seatLimit 后都创建成员导致超限。
        // 注：workspaces 表受 RLS 保护，事务内已注入 app.workspace_id / app.user_id，
        // 当前工作区行对成员可见，FOR UPDATE 不会与 RLS 冲突。
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${wid}::uuid FOR UPDATE`;

        const workspace = await tx.workspace.findUnique({ where: { id: wid } });
        const memberCount = await tx.member.count({ where: { workspaceId: wid } });

        // AC-08 席位上限：达 seatLimit 时拦截并提示升级
        if (workspace && memberCount >= workspace.seatLimit) {
          return { full: true as const, seatLimit: workspace.seatLimit };
        }

        const existing = await tx.member.findUnique({
          where: { userId_workspaceId: { userId: invitedUser.id, workspaceId: wid } },
        });
        if (existing) {
          return { duplicate: true as const };
        }

        const member = await tx.member.create({
          data: {
            userId: invitedUser.id,
            workspaceId: wid,
            role: "member",
            invitedBy: ctx.payload.sub,
          },
          include: { user: { select: { id: true, email: true, name: true, image: true } } },
        });

        // 查询邀请人姓名和工作区名称（用于邀请邮件）
        const inviter = await tx.user.findUnique({
          where: { id: ctx.payload.sub },
          select: { name: true, email: true },
        });
        const ws = await tx.workspace.findUnique({
          where: { id: wid },
          select: { name: true },
        });

        return {
          full: false as const,
          duplicate: false as const,
          member: {
            id: member.user.id,
            email: member.user.email,
            name: member.user.name,
            role: member.role,
          },
          workspaceName: ws?.name ?? "",
          inviterName: inviter?.name ?? inviter?.email ?? "",
        };
      },
      ctx.payload.sub,
    );

    if (result.full) {
      return NextResponse.json(
        { code: 402, message: "席位已满，请升级套餐以邀请更多成员", seatLimit: result.seatLimit },
        { status: 402 },
      );
    }
    if (result.duplicate) {
      return NextResponse.json({ code: 409, message: "该用户已是成员" }, { status: 409 });
    }

    // A-15: 发送邀请邮件（失败不阻断邀请，仅记录日志）
    try {
      await sendInviteEmail({
        to: result.member.email,
        workspaceName: result.workspaceName,
        inviterName: result.inviterName,
      });
    } catch (emailError) {
      console.error("[invite] sendInviteEmail failed:", emailError);
    }

    // P2 数据埋点：invite_member 事件（不阻塞主流程）
    await prisma.analyticsEvent
      .create({
        data: {
          id: randomUUID(),
          userId: ctx.payload.sub,
          workspaceId: wid,
          name: "invite_member",
          props: { role: "member" },
        },
      })
      .catch(() => {
        /* 埋点失败不影响主流程 */
      });

    return NextResponse.json({ code: 201, data: result.member }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, data: null, message: "请求参数无效", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[invite member] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
