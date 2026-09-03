import { NextRequest, NextResponse } from "next/server";
import { runWithShareToken, setTxGuc } from "@/lib/auth";

/**
 * GET /api/documents/share/{token} — 公开分享链接（无需登录）
 *
 * 用途：文档作者生成分享 token 后，将链接发给工作区外的人（客户/外包/顾问）。
 * 行为：返回文档元数据 + 已发布快照（publishedMarkdown）；无 publishedMarkdown
 * 表示从未发布，返回 404（草稿不可分享）。
 *
 * 安全：token 为 24 字节 base64url（192 位熵），不可猜；如需撤销在编辑页 PATCH
 * 传 shareToken=null 即可。读取经 runWithShareToken 注入 app.public_token，
 * 由 documents 表的 p_documents_share_select 策略放行（FORCE RLS 不绕过）；
 * 字段白名单不暴露 author.email 等敏感字段。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const doc = await runWithShareToken(token, async (tx) => {
      // 只凭 token 读文档标量列，关联读不可嵌套：各关联表同样受 RLS 约束，
      // 无 GUC 时嵌套关联返回空行，Prisma 对必需关联直接抛 Inconsistent
      // query result → 500（corps_app + FORCE RLS 加固模式下真实发生过的缺陷）。
      // 因此逐步放行：users 有意豁免 RLS 可直读；workspaces 需按已验证的
      // 文档行注入 workspace_id GUC 后方可读——工作区名只会随其被分享的文档泄露。
      const base = await tx.document.findFirst({
        where: { shareToken: token },
        select: {
          id: true,
          title: true,
          publishedMarkdown: true,
          publishedAt: true,
          workspaceId: true,
          authorId: true,
        },
      });
      if (!base?.publishedMarkdown) return null;

      const author = base.authorId
        ? await tx.user.findUnique({ where: { id: base.authorId }, select: { name: true } })
        : null;
      await setTxGuc(tx, "workspace_id", base.workspaceId);
      const workspace = await tx.workspace.findUnique({
        where: { id: base.workspaceId },
        select: { name: true, slug: true },
      });

      return {
        id: base.id,
        title: base.title,
        publishedMarkdown: base.publishedMarkdown,
        publishedAt: base.publishedAt,
        workspace,
        author,
      };
    });

    if (!doc || !doc.publishedMarkdown) {
      return NextResponse.json(
        { code: 404, message: "分享链接无效或文档尚未发布" },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: doc });
  } catch (error) {
    console.error("[GET share document] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
