import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { sendWeeklyDigestEmail, isEmailConfigured } from "@/lib/email";

/**
 * GET /api/cron/weekly-digest — 每周任务摘要邮件（Pro 功能，v2 定价 2026-09-02）
 *
 * 范围：仅 plan=pro（active 订阅）的工作区。另附本周运营漏斗数据
 * （注册/激活/活跃/任务创建计数）——owner 无需打开分析页即可在邮件里看到大盘。
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

      const totals = { registers: 0, activations: 0, taskCreates: 0, pageViews: 0 };
      if (proWorkspaces.length === 0) {
        return { sent: 0, skipped: 0, proWorkspaces: 0, stats: totals };
      }

      const workspaceIds = proWorkspaces.map((s) => s.workspaceId);
      // 本周运营埋点（供邮件漏斗段，逐工作区取）：Asia/Shanghai 最近 7 天窗口
      const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // 2) 一次性聚合本周运营埋点（按 workspaceId + name 分组，替代逐工作区 4 次 count）
      const eventAgg = await tx.analyticsEvent.groupBy({
        by: ["workspaceId", "name"],
        where: {
          workspaceId: { in: workspaceIds },
          createdAt: { gte: weekStart },
          name: { in: ["register_success", "activation_completed", "create_task", "page_view"] },
        },
        _count: { _all: true },
      });
      // 构建 workspaceId -> 埋点计数 映射
      const statsByWs = new Map<
        string,
        { registers: number; activations: number; taskCreates: number; pageViews: number }
      >();
      for (const agg of eventAgg) {
        if (!agg.workspaceId) continue;
        let s = statsByWs.get(agg.workspaceId);
        if (!s) {
          s = { registers: 0, activations: 0, taskCreates: 0, pageViews: 0 };
          statsByWs.set(agg.workspaceId, s);
        }
        switch (agg.name) {
          case "register_success": s.registers = agg._count._all; break;
          case "activation_completed": s.activations = agg._count._all; break;
          case "create_task": s.taskCreates = agg._count._all; break;
          case "page_view": s.pageViews = agg._count._all; break;
        }
      }

      // 3) 一次性查询所有 Pro 工作区的成员（带用户邮箱与显示名），按 workspaceId 分组
      const allMembers = await tx.member.findMany({
        where: { workspaceId: { in: workspaceIds } },
        include: { user: { select: { id: true, email: true, name: true } } },
      });
      const membersByWs = new Map<string, typeof allMembers>();
      for (const m of allMembers) {
        let arr = membersByWs.get(m.workspaceId);
        if (!arr) {
          arr = [];
          membersByWs.set(m.workspaceId, arr);
        }
        arr.push(m);
      }

      // 4) 一次性查询所有 Pro 工作区所有成员的未完成任务（逾期 + 未来 7 天到期），
      //    替代逐成员 2 次 findMany。按 dueDate asc 排序后内存分组，各组取前 10。
      const allAssigneeIds = allMembers.map((m) => m.userId);
      const allTasks = await tx.task.findMany({
        where: {
          workspaceId: { in: workspaceIds },
          assigneeId: { in: allAssigneeIds },
          status: { not: "done" },
          dueDate: { not: null },
          OR: [
            { dueDate: { lt: now } },
            { dueDate: { gte: now, lte: weekAhead } },
          ],
        },
        select: { id: true, title: true, dueDate: true, workspaceId: true, assigneeId: true },
        orderBy: { dueDate: "asc" },
      });
      // 按 (workspaceId:assigneeId) 分组，再分 overdue / upcoming，各取前 10
      type TaskLite = { id: string; title: string; dueDate: Date | null };
      const tasksByKey = new Map<string, { overdue: TaskLite[]; upcoming: TaskLite[] }>();
      for (const t of allTasks) {
        const aid = t.assigneeId;
        if (!aid || !t.dueDate) continue;
        const key = `${t.workspaceId}:${aid}`;
        let grp = tasksByKey.get(key);
        if (!grp) {
          grp = { overdue: [], upcoming: [] };
          tasksByKey.set(key, grp);
        }
        if (t.dueDate < now) {
          if (grp.overdue.length < 10) grp.overdue.push(t);
        } else if (t.dueDate >= now && t.dueDate <= weekAhead) {
          if (grp.upcoming.length < 10) grp.upcoming.push(t);
        }
      }

      let sent = 0;
      let skipped = 0;

      for (const sub of proWorkspaces) {
        const wid = sub.workspaceId;
        const wsName = sub.workspace.name;
        const wsStats = statsByWs.get(wid) ?? { registers: 0, activations: 0, taskCreates: 0, pageViews: 0 };
        totals.registers += wsStats.registers;
        totals.activations += wsStats.activations;
        totals.taskCreates += wsStats.taskCreates;
        totals.pageViews += wsStats.pageViews;

        const members = membersByWs.get(wid) ?? [];
        for (const m of members) {
          const key = `${wid}:${m.userId}`;
          const grp = tasksByKey.get(key);
          const overdue = grp?.overdue ?? [];
          const upcoming = grp?.upcoming ?? [];

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
            weeklyStats: wsStats,
          });
          if (ok) sent++;
          else skipped++;
        }
      }

      return {
        sent,
        skipped,
        proWorkspaces: proWorkspaces.length,
        stats: totals,
      };
    });

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[cron weekly-digest] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
