import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /api/cron/check-overdue-actions — 逾期行动项通知（每天定时调用）
 *
 * 检查所有未完成且逾期的行动项，对未发送过逾期通知的项创建站内通知。
 *
 * 逻辑：
 *  1. 查询所有 DecisionActionItem where:
 *     - removed = false
 *     - checked = false（未完成）
 *     - dueDate < now（已逾期）
 *     - taskId != null（有关联任务）
 *     - 任务 status != "done"
 *  2. 对每个逾期行动项：
 *     - 跳过无 assigneeId 的项（Notification.userId 必填）
 *     - 检查是否已发送过逾期通知（通过 notification type: "action_overdue" + entityId 去重）
 *     - 未发送则创建 Notification（entityId = 行动项 ID，保证每项只通知一次）
 *  3. 返回 { checked: N, notified: N, skipped: N }
 *
 * 鉴权：CRON_SECRET Bearer（与 /api/cron/due-reminders 同模式）。
 * 调度建议：每天 09:00 调用一次。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ code: 500, message: apiMsg(req, "cronSecretNotConfigured"), data: null }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });
  }

  try {
    const now = new Date();

    // cron op 逃生口：跨工作区只读 + 写通知（due-reminders / weekly-digest 同模式）
    const result = await runWithAuthOp("cron", async (tx) => {
      // 1) 查询所有未完成且逾期的行动项（有关联任务且任务未完成）
      //    task 关系过滤隐含 taskId != null
      const overdueItems = await tx.decisionActionItem.findMany({
        where: {
          removed: false,
          checked: false,
          dueDate: { lt: now },
          task: { status: { not: "done" } },
        },
        include: {
          decision: { select: { workspaceId: true } },
          task: { select: { id: true, title: true } },
        },
      });

      let notified = 0;
      let skipped = 0;

      for (const item of overdueItems) {
        // Notification.userId 必填，跳过无指派人的行动项
        if (!item.assigneeId) {
          skipped++;
          continue;
        }

        // 2) 检查是否已发送过逾期通知（按行动项 ID 去重，每项只通知一次）
        const existing = await tx.notification.findFirst({
          where: {
            type: "action_overdue",
            entityId: item.id,
          },
        });
        if (existing) {
          skipped++;
          continue;
        }

        // 3) 创建逾期通知
        //    entityTitle 截断到 255 字符（Notification.entityTitle 为 VarChar(255)）
        const dueDateStr = item.dueDate!.toISOString().slice(0, 10);
        const fullTitle = `行动项已逾期：${item.title}（截止日：${dueDateStr}）`;
        const entityTitle = fullTitle.length > 255 ? fullTitle.slice(0, 252) + "..." : fullTitle;

        await tx.notification.create({
          data: {
            userId: item.assigneeId,
            workspaceId: item.decision.workspaceId,
            type: "action_overdue",
            entityId: item.id,
            entityTitle,
          },
        });
        notified++;
      }

      return { checked: overdueItems.length, notified, skipped };
    });

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[cron check-overdue-actions] error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError"), data: null }, { status: 500 });
  }
}