import { NextRequest, NextResponse } from "next/server";
import { runWithAuthOp, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";
import { generatePush, type PushCapability } from "@/lib/ai/push-runner";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/ai-push-runner — AI 主动推送自动执行器（每 30 分钟定时调用）
 *
 * 遍历所有 enabled 的 AiPushSchedule，对到期的 schedule 调用 generatePush 生成推送内容，
 * 成功后创建站内通知（Notification type=ai_push）。
 *
 * 逻辑：
 *  1. CRON_SECRET Bearer 鉴权（与 /api/cron/check-overdue-actions 同模式）
 *  2. runWithAuthOp("cron") 跨工作区查询 enabled schedule
 *  3. 对每个 schedule 用 isDueNow 判断到期（cron 表达式 + lastRunAt 去重）
 *  4. 到期的调用 generatePush（不传 tx，内部自建 RLS 事务，避免跨工作区串行失败传染）
 *  5. generatePush 成功后创建 Notification（type=ai_push, entityId=record.id）
 *  6. 返回 { checked, triggered, notified, skipped }
 *
 * 鉴权：CRON_SECRET Bearer（与 /api/cron/* 路由约定一致）。
 * 调度建议：每 30 分钟调用一次（entrypoint-cron.sh 中配置）。
 */

/** cron 字段匹配（支持 * / , - / 步进语法，与标准 cron 语义一致） */
function matchesCronField(field: string, value: number, min: number, _max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const stepNum = parseInt(step, 10);
      const lo = range === "*" ? min : parseInt(range, 10);
      if ((value - lo) % stepNum === 0 && value >= lo) return true;
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (value >= lo && value <= hi) return true;
    } else {
      if (value === parseInt(part, 10)) return true;
    }
  }
  return false;
}

/**
 * 判断 schedule 是否在当前时刻到期。
 *
 * 简化语义（满足业务场景：每日简报 / 风险预警 / 进度异常均为日级推送）：
 *  - 仅检查 minute / hour / day-of-week 三个字段（day-of-month / month 忽略）
 *  - lastRunAt 去重：若今天已运行过（lastRunAt >= todayStart）则不再触发
 *
 * 这意味着每个 schedule 每天最多触发一次，与 AiPushRecord 的语义一致。
 */
function isDueNow(cron: string, lastRunAt: Date | null, now: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, , , dow] = parts;
  if (!matchesCronField(min, now.getMinutes(), 0, 59)) return false;
  if (!matchesCronField(hour, now.getHours(), 0, 23)) return false;
  if (!matchesCronField(dow, now.getDay(), 0, 6)) return false;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (lastRunAt && lastRunAt >= todayStart) return false;
  return true;
}

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

    // P1-fix: Notification 创建需要 workspace_id GUC，runWithAuthOp 事务内
    // 未设置该 GUC 会触发 RLS 拒绝。改为：事务内只读 schedule + 调 generatePush，
    // 把需要创建通知的成功结果收集到 triggeredSchedules；事务结束后逐个用
    // runWithWorkspace 包裹创建 Notification（每个独立 RLS 事务，失败仅 warn）。
    const triggeredSchedules: Array<{
      userId: string;
      workspaceId: string;
      capability: string;
      recordId: string;
    }> = [];

    // cron op 逃生口：跨工作区只读 schedule（与 check-overdue-actions 同模式）
    const result = await runWithAuthOp("cron", async (tx) => {
      // 1) 查询所有 enabled 的推送计划
      const schedules = await tx.aiPushSchedule.findMany({
        where: { enabled: true },
        select: {
          id: true,
          workspaceId: true,
          userId: true,
          capability: true,
          cron: true,
          lastRunAt: true,
        },
      });

      let triggered = 0;
      let skipped = 0;

      for (const schedule of schedules) {
        // 2) 判断是否到期
        if (!isDueNow(schedule.cron, schedule.lastRunAt, now)) {
          skipped++;
          continue;
        }

        // 3) 调用 generatePush 生成推送内容
        //    不传 tx：每个 schedule 独立 RLS 事务，避免跨工作区串行失败传染
        const pushResult = await generatePush({
          capability: schedule.capability as PushCapability,
          workspaceId: schedule.workspaceId,
          userId: schedule.userId,
          scheduleId: schedule.id,
        }).catch((e: unknown) => {
          logger.warn("[cron ai-push-runner] generatePush 抛异常", {
            error: e instanceof Error ? e.message : String(e),
            scheduleId: schedule.id,
            capability: schedule.capability,
            workspaceId: schedule.workspaceId,
          });
          return null;
        });

        if (!pushResult) {
          skipped++;
          continue;
        }
        triggered++;

        // 4) 收集成功结果，事务外再创建 Notification
        triggeredSchedules.push({
          userId: schedule.userId,
          workspaceId: schedule.workspaceId,
          capability: schedule.capability,
          recordId: pushResult.recordId,
        });
      }

      return { checked: schedules.length, triggered, skipped };
    });

    // 5) 事务结束后，逐个用 runWithWorkspace 包裹创建 Notification
    //    entityTitle 存储 i18n key（ai_push_${capability}），前端按 locale 翻译
    //    entityId = AiPushRecord.id，前端可查询推送详情
    //    type = "ai_push" 用于前端识别通知类型
    let notified = 0;
    for (const item of triggeredSchedules) {
      const ok = await runWithWorkspace(
        item.workspaceId,
        (tx) =>
          tx.notification.create({
            data: {
              userId: item.userId,
              workspaceId: item.workspaceId,
              type: "ai_push",
              entityId: item.recordId,
              entityTitle: `ai_push_${item.capability}`,
            },
          }),
        item.userId,
      )
        .then(() => true)
        .catch((e: unknown) => {
          logger.warn("[ai-push-runner] notification create failed", {
            error: e instanceof Error ? e.message : String(e),
            userId: item.userId,
            workspaceId: item.workspaceId,
            recordId: item.recordId,
          });
          return false;
        });
      if (ok) notified++;
    }

    return NextResponse.json({
      code: 200,
      data: { ...result, notified },
    });
  } catch (error) {
    logger.error("[cron ai-push-runner] error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  }
}
