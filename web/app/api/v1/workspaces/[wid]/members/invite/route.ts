import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithSeatCheck } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";

const inviteSchema = z.object({ email: z.string().email() });

/** 邀请有效期：7 天 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
      // 未注册用户：创建 pending invitation 并返回一次性邀请链接（不再 422）。
      // token 明文只在本次响应中出现一次；库中仅存 sha256 哈希，泄露库也无法伪造链接。
      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      const result = await runWithSeatCheck(wid, ctx.payload.sub, async (tx) => {
        // SELECT FOR UPDATE 锁定 workspace 行，串行化并发邀请事务（同直加路径的席位保护）
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${wid}::uuid FOR UPDATE`;

        const workspace = await tx.workspace.findUnique({ where: { id: wid } });
        const memberCount = await tx.member.count({ where: { workspaceId: wid } });

        // AC-08 席位上限：达 seatLimit 时拦截并提示升级
        if (workspace && memberCount >= workspace.seatLimit) {
          return { full: true as const, seatLimit: workspace.seatLimit };
        }

        // 同一 (workspace, email) 已有未接受且未过期的邀请 → 复用该记录，
        // 覆盖新 token 并延长过期时间（旧链接随之失效）
        const pending = await tx.invitation.findFirst({
          where: {
            workspaceId: wid,
            email,
            acceptedAt: null,
            expiresAt: { gt: new Date() },
          },
        });

        if (pending) {
          await tx.invitation.update({
            where: { id: pending.id },
            data: { tokenHash, expiresAt, invitedBy: ctx.payload.sub },
          });
        } else {
          await tx.invitation.create({
            data: {
              workspaceId: wid,
              email,
              tokenHash,
              role: "member",
              invitedBy: ctx.payload.sub,
              expiresAt,
            },
          });
        }

        // 查询邀请人姓名和工作区名称（用于邀请邮件）
        const inviter = await tx.user.findUnique({
          where: { id: ctx.payload.sub },
          select: { name: true, email: true },
        });

        return {
          full: false as const,
          workspaceName: workspace?.name ?? "",
          inviterName: inviter?.name ?? inviter?.email ?? "",
        };
      });

      if (result.full) {
        return NextResponse.json(
          { code: 402, message: "席位已满，请升级套餐以邀请更多成员", seatLimit: result.seatLimit },
          { status: 402 },
        );
      }

      // 发送邀请邮件（失败不阻断邀请，仅记录日志）
      try {
        await sendInviteEmail({
          to: email,
          workspaceName: result.workspaceName,
          inviterName: result.inviterName,
        });
      } catch (emailError) {
        console.error("[invite] sendInviteEmail failed:", emailError);
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      return NextResponse.json(
        {
          code: 201,
          data: {
            pending: true,
            email,
            inviteUrl: `${appUrl}/auth/signup?invite=${token}`,
          },
        },
        { status: 201 },
      );
    }

    // 席位检查 + 建成员在同一 RLS 事务内完成，避免并发邀请绕过 seatLimit
    const result = await runWithSeatCheck(wid, ctx.payload.sub, async (tx) => {
      // A-6: SELECT FOR UPDATE 锁定 workspace 行，串行化并发邀请事务，
      // 避免两个事务同时读到 memberCount < seatLimit 后都创建成员导致超限。
      // 注：seat 上下文（wid+uid+op）使 workspaces 的 SELECT/UPDATE 策略放行该行锁。
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
    });

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
    // props 增强（FUNNEL-METRICS §4.2）：channel 恒 "email"（现有唯一发出方式即邮件携带链接）；
    // seatUsage 从同函数上游 seatCheck 事务已知信息补全（全局 prisma 直查，先例 L28）
    let seatUsage: { used: number; limit: number } | undefined;
    try {
      const ws = await prisma.workspace.findUnique({
        where: { id: wid },
        select: { seatLimit: true },
      });
      if (ws) {
        const used = await prisma.member.count({ where: { workspaceId: wid } });
        seatUsage = { used, limit: ws.seatLimit };
      }
    } catch {
      // seatUsage 查询失败不阻断 invite_member 打点
    }
    await trackServerEvent({
      userId: ctx.payload.sub,
      workspaceId: wid,
      name: "invite_member",
      props: {
        role: "member",
        channel: "email",
        ...(seatUsage ? { seatUsage } : {}),
      },
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
