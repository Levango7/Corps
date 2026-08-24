import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

/**
 * GET /api/v1/invitations/[token]
 * 邀请链接公开预览（无需认证）：根据明文 token 的 sha256 哈希查找邀请，
 * 返回工作区名、邀请人、掩码邮箱与过期时间，供注册页展示"你被邀请加入…"。
 * 注：本路由不在 /workspaces/{wid} 下，invitations 表未启用 RLS，
 * 直接用 prisma 查询（与其他 auth 路由的 postgres 直连模式一致）。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        workspace: { select: { name: true } },
        // invitedBy 是普通外键列（非 Prisma relation），手动查邀请人信息
      },
    });
    if (!invitation) {
      return NextResponse.json({ code: 404, message: "Invitation not found" }, { status: 404 });
    }
    if (invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return NextResponse.json(
        { code: 410, message: "该邀请已失效（已接受或已过期）" },
        { status: 410 },
      );
    }

    const inviter = await prisma.user.findUnique({
      where: { id: invitation.invitedBy },
      select: { name: true, email: true },
    });

    // 邮箱掩码：保留前 2 字符 + *** + @域名
    const [local, domain] = invitation.email.split("@");
    const emailMasked = `${local.slice(0, 2)}***@${domain}`;

    return NextResponse.json({
      code: 200,
      data: {
        workspaceName: invitation.workspace.name,
        inviterName: inviter?.name ?? inviter?.email ?? "",
        emailMasked,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[invitation preview] error:", error);
    return NextResponse.json({ code: 500, message: "服务器内部错误" }, { status: 500 });
  }
}
