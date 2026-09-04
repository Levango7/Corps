import { NextRequest, NextResponse } from "next/server";
import { runWithShareToken, setTxGuc } from "@/lib/auth";

/**
 * GET /api/tasks/share/{token} — 任务公开只读分享（无需登录）。
 *
 * 用途：把任务（标题/描述/状态/优先级/子任务进度）发给工作区外的人看。
 * 安全：token 为 24 字节 base64url（192 位熵）；PATCH shareToken=null 即撤销。
 *
 * RLS（加固模式）：读取经 runWithShareToken 注入 app.public_token，
 * tasks 表的 p_tasks_share_select 策略放行 token 相等的行（FORCE RLS 不绕过）。
 * 关联读分步：users 豁免 RLS 可直读；workspace/children 在拿到 task 行后
 * 注入 workspace_id GUC 读取（与 documents share 同模式，避免嵌套关联在
 * RLS 下抛 Inconsistent query result）。
 * 脱敏：不返回 assignee.email、creator、评论、聊天与附件。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const data = await runWithShareToken(token, async (tx) => {
      // 只凭 token 读 tasks 标量列
      const task = await tx.task.findFirst({
        where: { shareToken: token },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
          assigneeId: true,
          workspaceId: true,
        },
      });
      if (!task) return null;

      // 子任务：注入 workspace_id GUC 后按 parentId 读（同工作区行放行）
      await setTxGuc(tx, "workspace_id", task.workspaceId);
      const children = await tx.task.findMany({
        where: { parentId: task.id },
        select: { id: true, title: true, status: true, blocked: true },
        orderBy: { createdAt: "asc" },
      });

      // 负责人：users 表豁免 RLS，可直读（仅取显示名）
      const assignee = task.assigneeId
        ? await tx.user.findUnique({
            where: { id: task.assigneeId },
            select: { name: true, email: true },
          })
        : null;
      const workspace = await tx.workspace.findUnique({
        where: { id: task.workspaceId },
        select: { name: true },
      });

      return {
        ...task,
        workspace,
        assignee: assignee ? { name: assignee.name || assignee.email.split("@")[0] } : null,
        children,
      };
    });

    if (!data) {
      return NextResponse.json({ code: 404, message: "分享链接无效或已被撤销" }, { status: 404 });
    }

    return NextResponse.json({ code: 200, data });
  } catch (error) {
    console.error("[GET share task] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
