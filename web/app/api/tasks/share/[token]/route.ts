import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/tasks/share/{token} — 任务公开只读分享（无需登录）。
 *
 * 用途：把任务（标题/描述/状态/优先级/子任务进度）发给工作区外的人看。
 * 安全：token 为 24 字节 base64url（192 位熵）；PATCH shareToken=null 即撤销。
 * 注意：任务不存快照——分享的是实时只读视图（与文档 publishedMarkdown 快照不同），
 * 敏感字段脱敏：不返回 assignee.email、creator.email、评论、聊天与附件。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    // 公开读跨工作区，绕过 runWithWorkspace（GUC）；字段白名单脱敏
    const { prisma } = await import("@/lib/prisma");
    const task = await prisma.task.findFirst({
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
        workspace: { select: { name: true } },
        assignee: { select: { name: true, email: true } },
        children: {
          where: {},
          select: { id: true, title: true, status: true, blocked: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ code: 404, message: "分享链接无效或已被撤销" }, { status: 404 });
    }

    // 脱敏：assignee 只出显示名（email 截断为前缀@域名形态或直接隐藏）
    const safe = {
      ...task,
      assignee: task.assignee
        ? { name: task.assignee.name || task.assignee.email.split("@")[0] }
        : null,
    };

    return NextResponse.json({ code: 200, data: safe });
  } catch (error) {
    console.error("[GET share task] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
