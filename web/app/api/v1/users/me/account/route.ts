import { NextRequest, NextResponse } from "next/server";
import { auth, authenticate } from "@/lib/auth";
import { z } from "zod";
import { previewAccountDeletion, deleteAccount } from "@/lib/account-deletion";

/**
 * 账户删除端点组（阶段 2-3：隐私政策"删除账户"承诺兑现）。
 *
 * GET    /api/v1/users/me/account —— 删除前数据预览
 *        （自有工作区/被邀工作区/日历连接/订阅/数据量统计）
 *
 * DELETE /api/v1/users/me/account —— 执行删除
 *        请求体 { confirmEmail }：必须与账户邮箱全文（大小写不敏感）匹配。
 *        schema 级联：自有工作区整租户删除；被邀工作区仅退出成员身份；
 *        日历 token 撤销；better-auth 会话/账号清理；通知邮件（尽力而为）。
 */

async function getUserId(req: NextRequest): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session?.user?.id) return session.user.id;
  } catch {
    // session 不存在或已过期，回退到 JWT
  }
  const payload = await authenticate(req);
  return payload?.sub ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const preview = await previewAccountDeletion(userId);
    return NextResponse.json({ code: 200, data: preview });
  } catch (error) {
    console.error("[deletion-preview] error:", error);
    return NextResponse.json({ code: 500, message: "服务器内部错误" }, { status: 500 });
  }
}

const deleteSchema = z.object({
  /** 二次确认：必须与账户邮箱全文（大小写不敏感）一致 */
  confirmEmail: z.string().email(),
});

export async function DELETE(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = deleteSchema.parse(await req.json());
    const session = await auth.api.getSession({ headers: req.headers });
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
    }
    // 邮箱二次确认（大小写不敏感）：不匹配即 400，绝不删除
    if (body.confirmEmail.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json(
        { code: 400, message: "确认邮箱与账户邮箱不一致，已取消删除" },
        { status: 400 },
      );
    }

    const { deletedWorkspaces } = await deleteAccount(userId);

    // 通知邮件（尽力而为：账户已删，Resend 发件不依赖账户存在）
    try {
      const { sendAccountDeletedEmail } = await import("@/lib/email");
      await sendAccountDeletedEmail({ to: email, deletedWorkspaces });
    } catch (err) {
      console.error("[delete-account] notify email failed (non-blocking):", err);
    }

    // 立即过期 access_token cookie，前端随删除成功跳转登录页
    const res = NextResponse.json({
      code: 200,
      data: { deleted: true, deletedWorkspaces },
    });
    res.headers.append("set-cookie", "access_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return res;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? "参数校验失败" },
        { status: 400 },
      );
    }
    console.error("[delete-account] error:", error);
    return NextResponse.json({ code: 500, message: "服务器内部错误" }, { status: 500 });
  }
}
