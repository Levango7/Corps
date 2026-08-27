import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createHash } from "crypto";

/**
 * GET /api/v1/invitations/[token]
 * 邀请链接公开预览（无需认证）：根据明文 token 的 sha256 哈希查找邀请，
 * 返回工作区名、邀请人、掩码邮箱与过期时间，供注册页展示"你被邀请加入…"。
 *
 * 安全基线：
 *  - TC-RATE-07：公开端点限流（单 IP 10 次/分钟），遏制 token 枚举探测；
 *  - TC-RLS-07：invitations 表已启用 FORCE RLS（db/rls-activate.sql p_invitations_rls），
 *    本路由无工作区上下文，经 invite 受控逃生口（runWithAuthOp("invite")）按 token 读取，
 *    与 accept 路由的取件方式一致。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // TC-RATE-07：限流前置，超限直接 429（含 Retry-After）
  const limited = await checkRateLimit(req, "invitations:preview", { max: 10, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const { token } = await params;
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // TC-RLS-07：invitations 表 FORCE RLS，直连 prisma 在加固模式（corps_app 角色）下
    // 读不到任何行（返回 null → 误报 404）。经 invite 逃生口在同一事务内取邀请 + 邀请人
    // （users 豁免 RLS，放同一事务减少连接往返且更整洁）。
    const result = await runWithAuthOp("invite", async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
        include: {
          workspace: { select: { name: true } },
          // invitedBy 是普通外键列（非 Prisma relation），手动查邀请人信息
        },
      });
      if (!invitation) return null;
      // 邀请人查询放同一逃生口事务内
      const inviter = await tx.user.findUnique({
        where: { id: invitation.invitedBy },
        select: { name: true, email: true },
      });
      return { invitation, inviter };
    });

    if (!result) {
      return NextResponse.json({ code: 404, message: "Invitation not found" }, { status: 404 });
    }
    const { invitation, inviter } = result;
    if (invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return NextResponse.json(
        { code: 410, message: "该邀请已失效（已接受或已过期）" },
        { status: 410 },
      );
    }

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
