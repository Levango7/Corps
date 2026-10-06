import type { Prisma } from "@prisma/client";

/** 站内通知的写入形态（只含 notifications 的业务列，id/created_at 走默认值） */
export interface NotifyRow {
  userId: string;
  workspaceId: string;
  type: string;
  entityId: string;
  entityTitle: string;
  read?: boolean;
}

/**
 * 写站内通知，可一次写给多人。
 *
 * 为什么某些调用点不能用 `tx.notification.create()`：
 * Prisma 的 create 发的是 `INSERT … RETURNING`，而 PostgreSQL 要求 RETURNING 返回的行
 * **再过一遍该表的 SELECT 策略**。notifications 的 SELECT 策略是
 * `workspace_id = app.workspace_id AND (app.user_id 未设置 OR user_id = app.user_id)`
 * （db/rls-activate.sql 的 DL-17 拆分，故意不给 SELECT 放行他人行，防"漏写 user_id
 * 过滤就能读别人通知"）。
 *
 * 于是触发条件很窄，**两个前提同时成立才会炸**（2026-10-06 实测）：
 *  ① 调用点给 `runWithWorkspace` 传了第三个参数 userId ⇒ `app.user_id` = 操作者；
 *  ② 通知的接收者不是这个操作者。
 * 满足时 create 抛 42501 `new row violates row-level security policy for table
 * "notifications"`，整个端点 500；不满足 ① 时（app.user_id 为空）容错分支放行，
 * create 照样能用——任务族（tasks/[id]、comments、decisions）正是靠"没传 userId"
 * 侥幸安全，**给它补上 user 作用域就会立刻变成 500**。
 *
 * 两条判据（证据链见 docs/audit/RLS-CROSS-USER-NOTIFY-2026-10-07.md）：
 *  - 同一事务、同一 GUC 下，裸 `INSERT … RETURNING` 也一样 42501 ⇒ 与 Prisma 无关，
 *    是 PG 的 RLS×RETURNING 语义；
 *  - 去掉 RETURNING（裸 INSERT / createMany）即通过 ⇒ 修复面只在"怎么写"，不动策略强度。
 *
 * 代价：createMany 不返回写入的行。需要 id 的调用点要么自己生成 id 后传入，要么把事务作用域
 * 切到接收者（`runWithWorkspace(wid, fn, recipientId)`，lib/notification/offline-push.ts 即
 * 此形态）——不要用 create 绕回来。
 */
export async function notifyUsers(
  tx: Pick<Prisma.TransactionClient, "notification">,
  rows: NotifyRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const res = await tx.notification.createMany({ data: rows });
  return res.count;
}
