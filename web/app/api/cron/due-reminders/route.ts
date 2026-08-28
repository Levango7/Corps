import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { sendTaskDueReminderEmail, isEmailConfigured } from "@/lib/email";

/**
 * GET /api/cron/due-reminders — 截止日提醒邮件（每天定时调用）
 *
 * 触发条件：任务的 dueDate 在"明天"（即距今 1 天的日期区间内），
 *           且任务未完成（status !== "done"），且被指派人非空。
 *
 * 鉴权：CRON_SECRET 环境变量。调用方通过 Authorization: Bearer ${CRON_SECRET} 传入。
 * 优雅降级：邮件服务未配置时直接返回 skip 计数，不报错。
 *
 * 调度建议：Vercel Cron（vercel.json）或外部调度器每天 09:00 调用一次。
 */
export async function GET(req: NextRequest) {
  // 鉴权：CRON_SECRET 必须配置且匹配
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

  try {
    // 计算"明天"的日期区间（UTC 当天 00:00 ~ 次日 00:00，覆盖各时区）
    // 简化方案：取距今 18~30 小时的 dueDate（覆盖 UTC+/-8 时区的"明天"）
    const now = Date.now();
    const from = new Date(now + 18 * 60 * 60 * 1000);
    const to = new Date(now + 30 * 60 * 60 * 1000);

    // tasks/workspaces 受 FORCE RLS：加固模式下裸查恒返 0 行且无任何报错
    // （健康假象），必须经 cron 逃生口做跨工作区只读扫描（db/rls-activate.sql）
    const tasks = await runWithAuthOp("cron", async (tx) =>
      tx.task.findMany({
        where: {
          dueDate: { gte: from, lt: to },
          status: { not: "done" },
          assigneeId: { not: null },
        },
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          workspace: { select: { id: true, name: true } },
        },
      }),
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    let sent = 0;
    let skipped = 0;

    for (const task of tasks) {
      if (!task.assignee || !task.workspace) {
        skipped++;
        continue;
      }
      try {
        await sendTaskDueReminderEmail({
          to: task.assignee.email,
          assigneeName: task.assignee.name ?? task.assignee.email,
          taskTitle: task.title,
          workspaceName: task.workspace.name,
          dueDate: task.dueDate!.toISOString(),
          taskUrl: `${appUrl}/w/${task.workspace.id}/task/${task.id}`,
        });
        sent++;
      } catch (err) {
        console.error("[cron due-reminders] send failed (non-blocking):", err);
        skipped++;
      }
    }

    return NextResponse.json({ code: 200, data: { sent, skipped, total: tasks.length } });
  } catch (error) {
    console.error("[cron due-reminders] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
