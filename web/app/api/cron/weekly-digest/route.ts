import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { sendWeeklyDigestEmail, isEmailConfigured } from "@/lib/email";

/**
 * GET /api/cron/weekly-digest — 每周任务摘要邮件（Pro 功能，v2 定价 2026-09-02）
 *
 * 范围：仅 plan=pro（active 订阅）的工作区。
 * 内容：向每位成员发送其负责任务的摘要——已逾期（未完成且截止日已过）+
 *       未来 7 天到期。无任何相关任务的成员不发送。
 *
 * 鉴权：CRON_SECRET Bearer（与 /api/cron/due-reminders 同模式）。
 * 调度建议：每周一 02:00 UTC（北京时间周一 10:00，corps-cron 容器内建计划）。
 * 优雅降级：邮件服务未配置时直接返回 skip 计数，不报错。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ code: 500, message: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({
      code: 200,
      data: { sent: 0, skipped: 0, reason: "email_not_configured" },
    });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    // cron op 逃生口：跨工作区只读扫描（due-reminders 同模式）
    const result = await runWithAuthOp("cron", async (tx) => {
      // 1) Pro 工作区（active 订阅）
      const proWorkspaces = await tx.subscription.findMany({
        where: { status: "active" },
        select: { workspaceId: true, workspace: { select: { id: true, name: true } } },
      });

      let sent = 0;
      let skipped = 0;

      for (const sub of proWorkspaces) {
        const wid = sub.workspaceId;
        const wsName = sub.workspace.name;

        // 2) 该工作区全部成员（带用户邮箱与显示名）
        const members = await tx.member.findMany({
          where: { workspaceId: wid },
          include: { user: { select: { id: true, email: true, name: true } } },
        });

        for (const m of members) {
          // 3) 该成员名下未完成任务：逾期 + 未来 7 天到期
          const overdue = await tx.task.findMany({
            where: {
              workspaceId: wid,
              assigneeId: m.userId,
              status: { not: "done" },
              dueDate: { not: null, lt: now },
            },
            select: { id: true, title: true, dueDate: true },
            orderBy: { dueDate: "asc" },
            take: 10,
          });
          const upcoming = await tx.task.findMany({
            where: {
              workspaceId: wid,
              assigneeId: m.userId,
              status: { not: "done" },
              dueDate: { not: null, gte: now, lte: weekAhead },
            },
            select: { id: true, title: true, dueDate: true },
            orderBy: { dueDate: "asc" },
            take: 10,
          });

          if (overdue.length === 0 && upcoming.length === 0) {
            skipped++;
            continue;
          }

          const ok = await sendWeeklyDigestEmail({
            to: m.user.email,
            memberName: m.user.name || m.user.email.split("@")[0],
            workspaceName: wsName,
            overdueTasks: overdue.map((t) => ({
              title: t.title,
              dueDate: t.dueDate!.toISOString(),
              taskUrl: `${appUrl}/w/${wid}/task/${t.id}`,
            })),
            upcomingTasks: upcoming.map((t) => ({
              title: t.title,
              dueDate: t.dueDate!.toISOString(),
              taskUrl: `${appUrl}/w/${wid}/task/${t.id}`,
            })),
            workspaceUrl: `${appUrl}/w/${wid}`,
          });
          if (ok) sent++;
          else skipped++;
        }
      }

      return { sent, skipped, proWorkspaces: proWorkspaces.length };
    });

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[cron weekly-digest] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
