/**
 * 日历集成：对账任务（reconciliation job）。
 *
 * 设计：
 *  - 定期扫描日历同步状态，清理异常数据并标记需要重试的连接
 *  - 不含实际调度（cron 等），仅提供函数实现供外部调度器调用
 *  - 与 sync.ts 同模式：经 runWithAuthOp("calendar", ...) 绕过 RLS 执行系统级作业
 *
 * 对账范围：
 *  1. 错误状态连接：syncStatus = "error" 的连接重置为 "idle"，允许下次同步重试
 *  2. 过期同步连接：lastSyncAt 超过 STALE_THRESHOLD 的连接，记录警告日志
 *  3. 孤儿事件映射：task_calendar_events 中有映射但对应 task 已不存在
 *     （onDelete: Cascade 理论上已处理，此为防御性检查）
 *
 * 调用方式：由 cron / 定时任务定期调用 reconcileCalendarSync()。
 */

import { runWithAuthOp } from "@/lib/auth";

/** 连接被判定为"过期"的阈值：7 天未同步 */
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
/** 单次对账扫描的连接上限，防止异常数据堆积导致全量扫描 */
const RECONCILE_BATCH_LIMIT = 200;

/** 对账结果 */
export interface ReconcileResult {
  /** 重置为 idle 的错误连接数 */
  resetErrorConnections: number;
  /** 检测到的过期连接数 */
  staleConnections: number;
  /** 清理的孤儿事件映射数 */
  orphanMappingsRemoved: number;
  /** 扫描的连接总数 */
  scannedConnections: number;
}

/**
 * 对账主函数：扫描日历同步状态，清理异常并标记重试。
 *
 * 幂等安全：多次调用结果一致，不会产生副作用累积。
 * 不抛异常：所有错误内部捕获并记录日志，对账失败不影响调度器。
 *
 * @returns 对账统计结果
 */
export async function reconcileCalendarSync(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    resetErrorConnections: 0,
    staleConnections: 0,
    orphanMappingsRemoved: 0,
    scannedConnections: 0,
  };

  try {
    await reconcileErrorConnections(result);
    await reconcileStaleConnections(result);
    await reconcileOrphanMappings(result);
  } catch (err) {
    console.error("[calendar-reconcile] 对账任务异常:", err);
  }

  console.info(
    `[calendar-reconcile] 对账完成: scanned=${result.scannedConnections} ` +
      `resetErrors=${result.resetErrorConnections} ` +
      `stale=${result.staleConnections} ` +
      `orphanRemoved=${result.orphanMappingsRemoved}`,
  );

  return result;
}

/**
 * 阶段 1：重置错误状态连接。
 * syncStatus = "error" 的连接重置为 "idle" 并清除 syncError，
 * 允许下次同步触发时重新尝试。
 */
async function reconcileErrorConnections(result: ReconcileResult): Promise<void> {
  const errorConnections = await runWithAuthOp("calendar", (tx) =>
    tx.calendarConnection.findMany({
      where: { syncStatus: "error" },
      select: { id: true, provider: true, userId: true, syncError: true, updatedAt: true },
      take: RECONCILE_BATCH_LIMIT,
    }),
  );

  if (errorConnections.length === 0) return;

  console.warn(
    `[calendar-reconcile] 发现 ${errorConnections.length} 个错误状态连接，重置为 idle 以便重试`,
  );

  for (const conn of errorConnections) {
    try {
      await runWithAuthOp("calendar", (tx) =>
        tx.calendarConnection.update({
          where: { id: conn.id },
          data: { syncStatus: "idle", syncError: null },
        }),
      );
      result.resetErrorConnections += 1;
      console.info(
        `[calendar-reconcile] 重置连接: connectionId=${conn.id} provider=${conn.provider} ` +
          `previousError=${conn.syncError?.slice(0, 100) ?? "unknown"}`,
      );
    } catch (err) {
      console.warn(
        `[calendar-reconcile] 重置连接失败: connectionId=${conn.id}`,
        err,
      );
    }
  }

  result.scannedConnections += errorConnections.length;
}

/**
 * 阶段 2：检测过期同步连接。
 * lastSyncAt 超过 STALE_THRESHOLD_MS 的连接记录警告日志，
 * 供运维人工排查（不自动修改状态，避免误触正在同步的连接）。
 */
async function reconcileStaleConnections(result: ReconcileResult): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleConnections = await runWithAuthOp("calendar", (tx) =>
    tx.calendarConnection.findMany({
      where: {
        OR: [
          { lastSyncAt: { lt: staleBefore } },
          { lastSyncAt: null },
        ],
        syncStatus: "idle",
      },
      select: { id: true, provider: true, userId: true, lastSyncAt: true },
      take: RECONCILE_BATCH_LIMIT,
    }),
  );

  if (staleConnections.length === 0) return;

  console.warn(
    `[calendar-reconcile] 发现 ${staleConnections.length} 个过期连接（超过 ${STALE_THRESHOLD_MS / (24 * 60 * 60 * 1000)} 天未同步）`,
  );

  for (const conn of staleConnections) {
    console.warn(
      `[calendar-reconcile] 过期连接: connectionId=${conn.id} provider=${conn.provider} ` +
        `lastSyncAt=${conn.lastSyncAt?.toISOString() ?? "never"}`,
    );
  }

  result.staleConnections = staleConnections.length;
  result.scannedConnections += staleConnections.length;
}

/**
 * 阶段 3：清理孤儿事件映射。
 * task_calendar_events 中有映射但对应 task 已不存在的记录。
 * 正常情况下 onDelete: Cascade 会自动清理，此为防御性检查，
 * 处理 Cascade 未覆盖的边界情况（如手动删表、迁移残留等）。
 */
async function reconcileOrphanMappings(result: ReconcileResult): Promise<void> {
  // 查找所有事件映射，分批检查对应 task 是否存在
  const mappings = await runWithAuthOp("calendar", (tx) =>
    tx.taskCalendarEvent.findMany({
      select: { id: true, taskId: true, connectionId: true, externalEventId: true },
      take: RECONCILE_BATCH_LIMIT,
    }),
  );

  if (mappings.length === 0) return;

  // 收集所有 taskId，批量查询存在的 task
  const taskIds = [...new Set(mappings.map((m) => m.taskId))];
  const existingTasks = await runWithAuthOp("calendar", (tx) =>
    tx.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true },
    }),
  );
  const existingTaskIds = new Set(existingTasks.map((t) => t.id));

  // 找出孤儿映射（task 已不存在）
  const orphans = mappings.filter((m) => !existingTaskIds.has(m.taskId));
  if (orphans.length === 0) return;

  console.warn(
    `[calendar-reconcile] 发现 ${orphans.length} 个孤儿事件映射（task 已删除但映射残留）`,
  );

  for (const orphan of orphans) {
    try {
      await runWithAuthOp("calendar", (tx) =>
        tx.taskCalendarEvent.delete({ where: { id: orphan.id } }),
      );
      result.orphanMappingsRemoved += 1;
      console.info(
        `[calendar-reconcile] 清理孤儿映射: mappingId=${orphan.id} ` +
          `taskId=${orphan.taskId} externalEventId=${orphan.externalEventId}`,
      );
    } catch (err) {
      console.warn(
        `[calendar-reconcile] 清理孤儿映射失败: mappingId=${orphan.id}`,
        err,
      );
    }
  }
}