import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { fanOutOfflineEmail } from "@/lib/notification/offline-push";

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
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "cronSecretNotConfigured"), data: null },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  try {
    const now = new Date();

    // cron op 逃生口：跨工作区只读 + 写通知（due-reminders / weekly-digest 同模式）
    // 离线邮件扇出的目标先收集在这里：SMTP 是网络 IO，不能进 RLS 事务，
    // 且响应形状要维持 {checked,notified,skipped}（契约门禁按此比对），所以不混进 tx 返回值。
    const offlineFanTargets: {
      userId: string;
      workspaceId: string;
      type: "action_overdue";
      entityId: string;
      entityTitle: string;
      bodySnippet: string;
    }[] = [];

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
        //    entityTitle 存储 i18n key（非硬编码中文），前端根据用户 locale 翻译。
        //    entityId = 行动项 ID，前端可通过 entityId 查询行动项详情（标题、截止日等）。
        //    type = "action_overdue" 用于前端识别通知类型并选择对应 i18n key。
        await tx.notification.create({
          data: {
            userId: item.assigneeId,
            workspaceId: item.decision.workspaceId,
            type: "action_overdue",
            entityId: item.id,
            entityTitle: "overdue_action_item",
          },
        });
        notified++;
        offlineFanTargets.push({
          userId: item.assigneeId,
          workspaceId: item.decision.workspaceId,
          type: "action_overdue",
          entityId: item.id,
          // 站内通知记录存 i18n key（前端按 locale 翻译），邮件是给人读的，所以带真实标题
          entityTitle: `逾期行动项：${item.task?.title ?? item.id}`,
          bodySnippet: "这条行动项已过截止日期且未完成，请及时处理。",
        });
      }

      return { checked: overdueItems.length, notified, skipped };
    });

    // 事务提交之后再补离线邮件扇出：SMTP 网络 IO 不进 RLS 事务。
    // 串行 await 而不是并发/即发即忘——扇出内部自带在线判定、偏好与 DND 判定、
    // 以及"用户没配默认邮箱账户就跳过"，所以绝大多数目标会快速返回；
    // 这条路由是定时任务，不在用户请求路径上，慢一点换"发信确实发生且可断言"。
    for (const target of offlineFanTargets) {
      await fanOutOfflineEmail(target);
    }

    return NextResponse.json({ code: 200, data: result });
  } catch (error) {
    console.error("[cron check-overdue-actions] error:", error);
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
