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

import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshAccessToken, revokeToken } from "./oauth";
import {
  createGoogleEvent,
  deleteGoogleEvent,
  getPrimaryCalendarId as getGooglePrimaryCalendarId,
  updateGoogleEvent,
} from "./google-client";
import {
  createOutlookEvent,
  deleteOutlookEvent,
  getPrimaryCalendarId as getOutlookPrimaryCalendarId,
  updateOutlookEvent,
} from "./outlook-client";
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

/** 解密连接的 access_token；如即将过期则自动刷新并持久化新 token */
async function ensureFreshAccessToken(connectionId: string): Promise<{
  accessToken: string;
  connection: { id: string; provider: string; calendarId: string; refreshToken: string };
}> {
  const conn = await prisma.calendarConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      provider: true,
      calendarId: true,
      accessToken: true,
      refreshToken: true,
      tokenExpiresAt: true,
    },
  });
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
    await prisma.calendarConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: encrypt(refreshed.access_token),
        refreshToken: newRefreshToken,
        tokenExpiresAt: newExpiresAt,
      },
    });
    return {
      accessToken,
      connection: { id: conn.id, provider: conn.provider, calendarId: conn.calendarId, refreshToken: conn.refreshToken },
    };
  }

  return {
    accessToken,
    connection: { id: conn.id, provider: conn.provider, calendarId: conn.calendarId, refreshToken: conn.refreshToken },
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
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, dueDate: true, workspaceId: true },
    });
    if (!task) return { success: true, syncedConnections: 0 };

    // debounce 检查
    if (!opts.force) {
      const existing = await prisma.taskCalendarEvent.findUnique({
        where: { taskId_connectionId: { taskId, connectionId } },
        select: { lastSyncedAt: true },
      });
      if (existing && Date.now() - existing.lastSyncedAt.getTime() < SYNC_DEBOUNCE_MS) {
        return { success: true, syncedConnections: 0 };
      }
    }

    // 标记同步中
    await prisma.calendarConnection.update({
      where: { id: connectionId },
      data: { syncStatus: "syncing", syncError: null },
    });

    const { accessToken, connection } = await ensureFreshAccessToken(connectionId);
    const provider = connection.provider as CalendarProvider;
    const taskUrl = buildTaskUrl(task.workspaceId, taskId);

    // 查询已有事件映射
    const eventMapping = await prisma.taskCalendarEvent.findUnique({
      where: { taskId_connectionId: { taskId, connectionId } },
    });

    if (!task.dueDate) {
      // 截止日期被移除 → 删除外部事件
      if (eventMapping) {
        if (provider === "google") {
          await deleteGoogleEvent(accessToken, connection.calendarId, eventMapping.externalEventId);
        } else {
          await deleteOutlookEvent(accessToken, connection.calendarId, eventMapping.externalEventId);
        }
        await prisma.taskCalendarEvent.delete({ where: { id: eventMapping.id } });
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
        // 更新
        if (provider === "google") {
          await updateGoogleEvent(accessToken, connection.calendarId, eventMapping.externalEventId, eventOpts);
        } else {
          await updateOutlookEvent(accessToken, connection.calendarId, eventMapping.externalEventId, eventOpts);
        }
        await prisma.taskCalendarEvent.update({
          where: { id: eventMapping.id },
          data: { lastSyncedAt: new Date() },
        });
      } else {
        // 创建
        const externalEventId =
          provider === "google"
            ? await createGoogleEvent(accessToken, connection.calendarId, eventOpts)
            : await createOutlookEvent(accessToken, connection.calendarId, eventOpts);
        await prisma.taskCalendarEvent.create({
          data: { taskId, connectionId, externalEventId },
        });
      }
    }

    // 标记同步成功
    await prisma.calendarConnection.update({
      where: { id: connectionId },
      data: { syncStatus: "idle", syncError: null, lastSyncAt: new Date() },
    });

    return { success: true, syncedConnections: 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 标记同步失败
    await prisma.calendarConnection.update({
      where: { id: connectionId },
      data: { syncStatus: "error", syncError: message },
    }).catch(() => {});
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
  const connections = await prisma.calendarConnection.findMany({
    where: { userId },
    select: { id: true },
  });
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
  const connections = await prisma.calendarConnection.findMany({
    where: { userId },
    select: { id: true },
  });
  if (connections.length === 0) return { success: true, syncedConnections: 0 };

  // 只同步有截止日期的任务
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: userId,
      dueDate: { not: null },
    },
    select: { id: true },
  });

  let synced = 0;
  let lastError: string | undefined;
  for (const task of tasks) {
    for (const conn of connections) {
      const result = await syncTaskToCalendar(task.id, conn.id, { force: true });
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
export async function disconnectCalendar(userId: string, provider: CalendarProvider): Promise<void> {
  const conn = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { id: true, accessToken: true },
  });
  if (!conn) return;

  // 撤销 token（失败不阻塞）
  try {
    const accessToken = decrypt(conn.accessToken);
    await revokeToken(provider, accessToken);
  } catch {
    // 忽略撤销失败
  }

  // 删除连接记录（级联删除 TaskCalendarEvent）
  await prisma.calendarConnection.delete({ where: { id: conn.id } });
}