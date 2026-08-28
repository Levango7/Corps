import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithSeatCheck, runWithWorkspace } from "@/lib/auth";
import { trackServerEvent } from "@/lib/analytics-server";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { evaluateSeatGate, expandProSeatsAfterJoin } from "@/lib/billing/seat-policy";
import { expireSubscriptionIfDue } from "@/lib/billing/subscription-expiry";
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

  // 国内一次性支付的到期懒降级（尽力而为）：先落到位，再做席位门控判定
  await expireSubscriptionIfDue(wid);

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

        // AC-08 席位门控（分套餐策略，见 lib/billing/seat-policy.ts）：
        // free 达上限拦截；pro+Stripe 自动扩席放行；pro+国内通道拦截提示增购
        if (workspace) {
          const gate = await evaluateSeatGate(tx, wid, workspace, memberCount);
          if (gate.full) {
            return { full: true as const, plan: gate.plan, seatLimit: gate.seatLimit };
          }
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
          {
            code: 402,
            message:
              result.plan === "pro"
                ? "席位已满，请增购或续费套餐后邀请更多成员"
                : "席位已满，请升级套餐以邀请更多成员",
            seatLimit: result.seatLimit,
          },
          { status: 402 },
        );
      }

      // 一次性邀请链接：token 明文只在此处与响应中出现，邮件必须携带，
      // 否则未注册受邀者无法完成接受流程（accept 接口按 token 取件）
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const inviteUrl = `${appUrl}/auth/signup?invite=${token}`;

      // 发送邀请邮件（失败不阻断邀请，仅记录日志）
      try {
        await sendInviteEmail({
          to: email,
          workspaceName: result.workspaceName,
          inviterName: result.inviterName,
          inviteUrl,
        });
      } catch (emailError) {
        console.error("[invite] sendInviteEmail failed:", emailError);
      }

      return NextResponse.json(
        {
          code: 201,
          data: {
            pending: true,
            email,
            inviteUrl,
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

      // AC-08 席位门控（分套餐策略，见 lib/billing/seat-policy.ts）
      let autoExpand = false;
      if (workspace) {
        const gate = await evaluateSeatGate(tx, wid, workspace, memberCount);
        if (gate.full) {
          return { full: true as const, plan: gate.plan, seatLimit: gate.seatLimit };
        }
        autoExpand = gate.autoExpand;
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
        // pro+Stripe 门控放行时需在事务外扩席（seatLimit+通道侧 quantity）
        autoExpand,
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
        {
          code: 402,
          message:
            result.plan === "pro"
              ? "席位已满，请增购或续费套餐后邀请更多成员"
              : "席位已满，请升级套餐以邀请更多成员",
          seatLimit: result.seatLimit,
        },
        { status: 402 },
      );
    }
    if (result.duplicate) {
      return NextResponse.json({ code: 409, message: "该用户已是成员" }, { status: 409 });
    }

    // Pro + Stripe：加入后自动扩席（seatLimit 跟随人数 + 通道侧 quantity 按比例计费）
    if (result.autoExpand) {
      await expandProSeatsAfterJoin(wid);
    }

    // A-15: 发送邀请邮件（失败不阻断邀请，仅记录日志）
    // 已注册用户被直加为成员（无邀请 token），邮件为"已加入"通知
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      await sendInviteEmail({
        to: result.member.email,
        workspaceName: result.workspaceName,
        inviterName: result.inviterName,
        loginUrl: `${appUrl}/auth/login`,
      });
    } catch (emailError) {
      console.error("[invite] sendInviteEmail failed:", emailError);
    }

    // P2 数据埋点：invite_member 事件（不阻塞主流程）
    // props 增强（FUNNEL-METRICS §4.2）：channel 恒 "email"（现有唯一发出方式即邮件携带链接）；
    // seatUsage 取自已验证的工作区上下文。
    // TC-RLS-07：workspaces / members 均在 RLS 范围（db/rls-activate.sql），全局 prisma
    // 直查在加固模式下读不到行（seatUsage 恒缺失）。本路由持有 getWorkspaceContext
    // 验证过的 wid，属常规租户上下文，用 runWithWorkspace 注入 workspace_id + user_id
    // GUC 走正常租户谓词——而非 runWithAuthOp 逃生口（后者仅限无 wid 上下文的
    // 公开/系统路径；且 p_members_select 的 provision 分支附 user_id 相等条件，
    // 用逃生口 count 只能见到本人成员行，seatUsage 数值会失真）。
    let seatUsage: { used: number; limit: number } | undefined;
    try {
      const seatStats = await runWithWorkspace(
        wid,
        async (tx) => {
          const ws = await tx.workspace.findUnique({
            where: { id: wid },
            select: { seatLimit: true },
          });
          if (!ws) return null;
          const used = await tx.member.count({ where: { workspaceId: wid } });
          return { used, limit: ws.seatLimit };
        },
        ctx.payload.sub,
      );
      if (seatStats) seatUsage = seatStats;
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
