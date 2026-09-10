/**
 * 日历集成：任务→日历同步核心逻辑。
 *
 * 设计：
 *  - 单向同步（任务→日历），MVP 不做反向同步
 *  - 触发：任务 dueDate 变更时调用 syncTaskToCalendar
 *  - debounce：每任务每 5 分钟最多同步一次（用 lastSyncedAt 判断）
 *  - token 自动刷新：access_token 过期前 5 分钟用 refresh_token 刷新
 *  - 错误重试：最多 3 次，指数退避（1s → 2s → 4s）
 *  - 数据隐私：只同步标题 + 截止日期 + 任务链接，不同步任务正文
 */

import { runWithAuthOp, withGuc } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken, revokeToken } from "./oauth";
import { createGoogleEvent, deleteGoogleEvent, updateGoogleEvent } from "./google-client";
import { createOutlookEvent, deleteOutlookEvent, updateOutlookEvent } from "./outlook-client";
import type { CalendarProvider } from "./config";

/** 同步 debounce 窗口：5 分钟 */
const SYNC_DEBOUNCE_MS = 5 * 60 * 1000;
/** access_token 提前刷新阈值：5 分钟 */
const TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;
/** 错误重试次数 */
const MAX_RETRIES = 3;
/** 默认提醒分钟数：提前 1 天 + 1 小时 */
const DEFAULT_REMINDER_MINUTES = [1440, 60];

/** 同步结果 */
export interface SyncResult {
  success: boolean;
  error?: string;
  syncedConnections: number;
}

/** ensureFreshAccessToken 返回类型 */
interface FreshTokenResult {
  accessToken: string;
  connection: { id: string; provider: string; calendarId: string; refreshToken: string };
}

/**
 * S5 修复：token 刷新内存锁——同一 connectionId 的并发请求共享同一个刷新 Promise，
 * 避免多个并发同步同时刷新 token（导致旧 refresh_token 失效、token 错乱）。
 *
 * 锁的生命周期：从首次刷新请求开始到 Promise 完成（无论成功/失败）。
 * 后续并发请求直接 await 同一 Promise，不重复刷新。
 * 锁清除在 finally 块中，确保异常时也释放锁。
 *
 * 局限：仅单进程内有效。多实例部署时需升级为分布式锁（如 Redis SET NX EX）。
 * 当前同步作业经 cron 单实例触发，内存锁足够。
 */
const tokenRefreshLocks = new Map<string, Promise<FreshTokenResult>>();

/** 解密连接的 access_token；如即将过期则自动刷新并持久化新 token */
async function ensureFreshAccessToken(connectionId: string): Promise<FreshTokenResult> {
  // S5 修复：并发请求共享同一刷新 Promise
  const existing = tokenRefreshLocks.get(connectionId);
  if (existing) return existing;

  const promise = doEnsureFreshAccessToken(connectionId);
  tokenRefreshLocks.set(connectionId, promise);
  try {
    return await promise;
  } finally {
    tokenRefreshLocks.delete(connectionId);
  }
}

/** ensureFreshAccessToken 的实际实现（无锁，由外层 ensureFreshAccessToken 加锁） */
async function doEnsureFreshAccessToken(connectionId: string): Promise<FreshTokenResult> {
  // calendar_connections 受 FORCE RLS（user_id 谓词 + calendar 逃生口）：
  // 同步作业按连接 id 定位，经 calendar op 放行
  const conn = await runWithAuthOp("calendar", (tx) =>
    tx.calendarConnection.findUnique({
      where: { id: connectionId },
      select: {
        id: true,
        provider: true,
        calendarId: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiresAt: true,
      },
    }),
  );
  if (!conn) throw new Error("日历连接不存在");

  let accessToken = decrypt(conn.accessToken);
  const now = Date.now();
  const expiresAt = conn.tokenExpiresAt.getTime();

  // access_token 即将过期（提前 5 分钟）→ 用 refresh_token 刷新
  if (expiresAt - now < TOKEN_REFRESH_LEAD_MS) {
    const refreshToken = decrypt(conn.refreshToken);
    const refreshed = await refreshAccessToken(conn.provider as CalendarProvider, refreshToken);
    accessToken = refreshed.access_token;
    const newExpiresAt = new Date(now + refreshed.expires_in * 1000);
    // refresh_token 可能不返回（Google 首次授权后才返回；后续刷新沿用旧值）
    const newRefreshToken = refreshed.refresh_token
      ? encrypt(refreshed.refresh_token)
      : conn.refreshToken;
    await runWithAuthOp("calendar", (tx) =>
      tx.calendarConnection.update({
        where: { id: connectionId },
        data: {
          accessToken: encrypt(refreshed.access_token),
          refreshToken: newRefreshToken,
          tokenExpiresAt: newExpiresAt,
        },
      }),
    );
    return {
      accessToken,
      connection: {
        id: conn.id,
        provider: conn.provider,
        calendarId: conn.calendarId,
        refreshToken: conn.refreshToken,
      },
    };
  }

  return {
    accessToken,
    connection: {
      id: conn.id,
      provider: conn.provider,
      calendarId: conn.calendarId,
      refreshToken: conn.refreshToken,
    },
  };
}

/** 构造任务链接 */
function buildTaskUrl(wid: string, taskId: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${appUrl}/w/${wid}/task/${taskId}`;
}

/**
 * 同步单个任务到指定连接。
 * - 任务无 dueDate → 删除已存在的事件
 * - 任务有 dueDate + 已有事件映射 → 更新事件
 * - 任务有 dueDate + 无事件映射 → 创建事件
 *
 * debounce：距上次同步不足 5 分钟则跳过（force=true 可绕过）
 */
export async function syncTaskToCalendar(
  taskId: string,
  connectionId: string,
  opts: { force?: boolean } = {},
): Promise<SyncResult> {
  try {
    // tasks 表 FORCE RLS（db/rls-activate.sql）：裸 prisma.task 直查在加固模式下
    // 恒返 null → 同步静默跳过（审计 P1-A）。经 calendar 逃生口做跨工作区只读
    // 定位（同步属用户级系统作业，与 cron 截止日提醒同信任级别）。
    const task = await runWithAuthOp("calendar", (tx) =>
      tx.task.findUnique({
        where: { id: taskId },
        select: { id: true, title: true, dueDate: true, workspaceId: true },
      }),
    );
    if (!task) return { success: true, syncedConnections: 0 };

    // debounce 检查（task_calendar_events 受 FORCE RLS，calendar op 放行）
    if (!opts.force) {
      const existing = await runWithAuthOp("calendar", (tx) =>
        tx.taskCalendarEvent.findUnique({
          where: { taskId_connectionId: { taskId, connectionId } },
          select: { lastSyncedAt: true },
        }),
      );
      if (existing && Date.now() - existing.lastSyncedAt.getTime() < SYNC_DEBOUNCE_MS) {
        return { success: true, syncedConnections: 0 };
      }
    }

    // 合并事务 1：标记同步中 + 查询已有事件映射（减少独立短事务，M2）
    const eventMapping = await runWithAuthOp("calendar", async (tx) => {
      await tx.calendarConnection.update({
        where: { id: connectionId },
        data: { syncStatus: "syncing", syncError: null },
      });
      return tx.taskCalendarEvent.findUnique({
        where: { taskId_connectionId: { taskId, connectionId } },
      });
    });

    const { accessToken, connection } = await ensureFreshAccessToken(connectionId);
    const provider = connection.provider as CalendarProvider;
    const taskUrl = buildTaskUrl(task.workspaceId, taskId);

    if (!task.dueDate) {
      // 截止日期被移除 → 删除外部事件
      if (eventMapping) {
        // 外部 API 调用（事务外，避免长事务持有外部 IO）
        if (provider === "google") {
          await deleteGoogleEvent(accessToken, connection.calendarId, eventMapping.externalEventId);
        } else {
          await deleteOutlookEvent(
            accessToken,
            connection.calendarId,
            eventMapping.externalEventId,
          );
        }
        // 合并事务 2：DB 删除 eventMapping + 标记同步成功（M2）
        await runWithAuthOp("calendar", async (tx) => {
          await tx.taskCalendarEvent.delete({ where: { id: eventMapping.id } });
          await tx.calendarConnection.update({
            where: { id: connectionId },
            data: { syncStatus: "idle", syncError: null, lastSyncAt: new Date() },
          });
        });
      } else {
        // 无事件映射，只需标记同步成功
        await runWithAuthOp("calendar", (tx) =>
          tx.calendarConnection.update({
            where: { id: connectionId },
            data: { syncStatus: "idle", syncError: null, lastSyncAt: new Date() },
          }),
        );
      }
    } else {
      // 有截止日期 → 创建或更新
      const eventOpts = {
        title: task.title,
        dueDate: task.dueDate.toISOString(),
        taskUrl,
        reminderMinutes: DEFAULT_REMINDER_MINUTES,
      };

      if (eventMapping) {
        // 更新（外部 API 调用，事务外）
        if (provider === "google") {
          await updateGoogleEvent(
            accessToken,
            connection.calendarId,
            eventMapping.externalEventId,
            eventOpts,
          );
        } else {
          await updateOutlookEvent(
            accessToken,
            connection.calendarId,
            eventMapping.externalEventId,
            eventOpts,
          );
        }
        // 合并事务 2：DB 更新 eventMapping + 标记同步成功（M2）
        await runWithAuthOp("calendar", async (tx) => {
          await tx.taskCalendarEvent.update({
            where: { id: eventMapping.id },
            data: { lastSyncedAt: new Date() },
          });
          await tx.calendarConnection.update({
            where: { id: connectionId },
            data: { syncStatus: "idle", syncError: null, lastSyncAt: new Date() },
          });
        });
      } else {
        // 创建（外部 API 调用，事务外）
        const externalEventId =
          provider === "google"
            ? await createGoogleEvent(accessToken, connection.calendarId, eventOpts)
            : await createOutlookEvent(accessToken, connection.calendarId, eventOpts);
        // S4 修复：外部 API 已创建事件但 DB 更新失败时，补偿删除外部事件，
        // 避免产生孤儿事件（外部日历有事件但本地无映射，用户可见但系统不可控）。
        try {
          await runWithAuthOp("calendar", async (tx) => {
            await tx.taskCalendarEvent.create({
              data: { taskId, connectionId, externalEventId },
            });
            await tx.calendarConnection.update({
              where: { id: connectionId },
              data: { syncStatus: "idle", syncError: null, lastSyncAt: new Date() },
            });
          });
        } catch (dbErr) {
          // DB 创建失败 → 补偿删除外部事件
          try {
            if (provider === "google") {
              await deleteGoogleEvent(accessToken, connection.calendarId, externalEventId);
            } else {
              await deleteOutlookEvent(accessToken, connection.calendarId, externalEventId);
            }
            console.warn(
              `[calendar-sync] S4 补偿删除外部事件成功: connectionId=${connectionId} externalEventId=${externalEventId}`,
            );
          } catch (compensateErr) {
            // 补偿也失败：孤儿事件残留，记日志供对账任务清理
            console.error(
              `[calendar-sync] S4 补偿删除外部事件失败，产生孤儿: connectionId=${connectionId} externalEventId=${externalEventId}`,
              compensateErr,
            );
          }
          throw dbErr; // 重新抛出，由外层 catch 标记 syncStatus=error
        }
      }
    }

    return { success: true, syncedConnections: 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // M16 修复：截断错误信息到 500 字符，避免过长/敏感信息全量写入 DB
    // （syncError 为 Text 字段可存长文本，但截断防止巨量错误堆栈占空间）
    const truncatedError = message.slice(0, 500);
    // 标记同步失败（错误标记失败不阻塞错误返回）
    await runWithAuthOp("calendar", (tx) =>
      tx.calendarConnection
        .update({
          where: { id: connectionId },
          data: { syncStatus: "error", syncError: truncatedError },
        })
        .catch(() => {}),
    ).catch(() => {});
    return { success: false, error: message, syncedConnections: 0 };
  }
}

/**
 * 同步单个任务到用户的所有已连接日历。
 * 用于任务 dueDate 变更时触发（不阻塞主流程）。
 */
export async function syncTaskToAllCalendars(
  taskId: string,
  userId: string,
  opts: { force?: boolean } = {},
): Promise<SyncResult> {
  // calendar_connections 受 FORCE RLS（user_id / calendar op）：同步作业经逃生口
  // M17 修复：添加 take 上限，防止异常数据堆积导致全量扫描
  // （正常单用户连接数 ≤ provider 数，上限 20 留足余量）
  const SYNC_CONNECTIONS_LIMIT = 20;
  const connections = await runWithAuthOp(
    "calendar",
    (tx) =>
      tx.calendarConnection.findMany({
        where: { userId },
        select: { id: true },
        take: SYNC_CONNECTIONS_LIMIT,
      }),
    userId,
  );
  if (connections.length === 0) return { success: true, syncedConnections: 0 };

  let synced = 0;
  let lastError: string | undefined;
  for (const conn of connections) {
    const result = await syncTaskToCalendar(taskId, conn.id, opts);
    if (result.success) {
      synced += result.syncedConnections;
    } else {
      lastError = result.error;
    }
  }
  return {
    success: lastError === undefined,
    error: lastError,
    syncedConnections: synced,
  };
}

/**
 * 同步用户的所有任务到所有已连接日历。
 * 用于手动触发"立即同步"。
 */
export async function syncAllTasks(userId: string): Promise<SyncResult> {
  // M17 修复：添加 take 上限（同 syncTaskToAllCalendars）
  const SYNC_CONNECTIONS_LIMIT = 20;
  const connections = await runWithAuthOp(
    "calendar",
    (tx) =>
      tx.calendarConnection.findMany({
        where: { userId },
        select: { id: true },
        take: SYNC_CONNECTIONS_LIMIT,
      }),
    userId,
  );
  if (connections.length === 0) return { success: true, syncedConnections: 0 };

  // 只同步有截止日期的任务（同上：tasks 受 FORCE RLS，经 calendar 逃生口只读扫描）
  // M3：加 take 上限保护，防止用户任务量过大时全表扫描拖慢同步
  const SYNC_ALL_TASKS_LIMIT = 500;
  const tasks = await runWithAuthOp("calendar", (tx) =>
    tx.task.findMany({
      where: {
        assigneeId: userId,
        dueDate: { not: null },
      },
      select: { id: true },
      take: SYNC_ALL_TASKS_LIMIT,
    }),
  );
  if (tasks.length === SYNC_ALL_TASKS_LIMIT) {
    console.warn(
      `[syncAllTasks] 用户 ${userId} 的待同步任务达到 take 上限 ${SYNC_ALL_TASKS_LIMIT}，` +
        `可能有更多任务未同步，请考虑分批同步或提高上限`,
    );
  }

  let synced = 0;
  let lastError: string | undefined;
  for (const task of tasks) {
    // M3 修复：内层循环改为并发（Promise.all），减少总等待时间。
    // 外层仍串行遍历 tasks，避免一次性并发过多日历 API 请求触发限流。
    const results = await Promise.all(
      connections.map((conn) => syncTaskToCalendar(task.id, conn.id, { force: true })),
    );
    for (const result of results) {
      if (result.success) {
        synced += result.syncedConnections;
      } else {
        lastError = result.error;
      }
    }
  }
  return {
    success: lastError === undefined,
    error: lastError,
    syncedConnections: synced,
  };
}

/** 带重试的同步（指数退避：1s → 2s → 4s） */
export async function syncTaskWithRetry(
  taskId: string,
  connectionId: string,
  opts: { force?: boolean } = {},
): Promise<SyncResult> {
  let lastResult: SyncResult = { success: false, syncedConnections: 0 };
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    lastResult = await syncTaskToCalendar(taskId, connectionId, opts);
    if (lastResult.success) return lastResult;
    // 指数退避：1s, 2s, 4s
    const delayMs = 1000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return lastResult;
}

/** 断开连接：撤销 OAuth token + 删除连接记录（级联删除事件映射） */
export async function disconnectCalendar(
  userId: string,
  provider: CalendarProvider,
): Promise<void> {
  // calendar_connections 受 FORCE RLS（user_id 谓词）：disconnect 路由已认证本人
  const conn = await withGuc({ user_id: userId }, (tx) =>
    tx.calendarConnection.findUnique({
      where: { userId_provider: { userId, provider } },
      select: { id: true, accessToken: true },
    }),
  );
  if (!conn) return;

  // 撤销 token（失败不阻塞）
  try {
    const accessToken = decrypt(conn.accessToken);
    await revokeToken(provider, accessToken);
  } catch {
    // 忽略撤销失败
  }

  // 删除连接记录（级联删除 TaskCalendarEvent）
  await withGuc({ user_id: userId }, (tx) =>
    tx.calendarConnection.delete({ where: { id: conn.id } }),
  );
}
