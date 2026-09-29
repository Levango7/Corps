/**
 * 通知偏好（NotificationPreference）的唯一读取与判定入口。
 *
 * 为什么单独成模块：偏好表此前**只有** lib/notification/offline-push.ts 在读，
 * 而那个模块全仓零调用 —— 于是"邮件通知/推送通知/免打扰"三个开关没有任何
 * 在跑的代码路径会尊重它。把"读偏好 + 判定"抽出来后，实时路径（评论 @提及邮件）
 * 与离线路径（offline-push）共用同一份语义，设置页的开关才真的等于行为。
 */

import { prisma } from "@/lib/prisma";

/** DND 判定所需的最小字段（便于纯函数单测） */
export interface DndPreference {
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
}

/** 完整通知偏好（对应 notification_preferences 表） */
export interface NotifyPreference extends DndPreference {
  emailNotify: boolean;
  pushNotify: boolean;
}

/** 查不到记录时的默认值：全开、不免打扰（与 schema 的 @default 一致） */
const DEFAULT_PREFERENCE: NotifyPreference = {
  emailNotify: true,
  pushNotify: true,
  dndEnabled: false,
  dndStart: "22:00",
  dndEnd: "08:00",
};

/**
 * 取用户通知偏好；无记录时落一行默认值（保持与既有 upsert 行为一致，
 * 使设置页首次打开就能看到并写回）。
 */
export async function getNotificationPreferences(userId: string): Promise<NotifyPreference> {
  try {
    return await prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: {
        emailNotify: true,
        pushNotify: true,
        dndEnabled: true,
        dndStart: true,
        dndEnd: true,
      },
    });
  } catch (error) {
    console.error("[notification/preferences] 读取偏好失败，回退默认值:", error);
    return DEFAULT_PREFERENCE;
  }
}

/**
 * 当前时间是否处于免打扰时段，支持跨午夜区间（如 22:00–08:00）。
 * 起止相同视为空区间，不抑制。
 */
export function isDndActive(preference: DndPreference): boolean {
  if (!preference.dndEnabled) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const startParts = preference.dndStart.split(":").map(Number);
  const endParts = preference.dndEnd.split(":").map(Number);
  const startMinutes = (startParts[0] ?? 0) * 60 + (startParts[1] ?? 0);
  const endMinutes = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0);

  if (startMinutes === endMinutes) return false;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // 跨午夜：22:00–08:00 → 当前 ≥22:00 或 <08:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/** 该用户此刻是否应发送邮件通知（关闭邮件偏好或处于 DND 都抑制） */
export function shouldSendEmail(preference: NotifyPreference): boolean {
  return preference.emailNotify && !isDndActive(preference);
}

/** 该用户此刻是否应发送浏览器/设备推送 */
export function shouldSendPush(preference: NotifyPreference): boolean {
  return preference.pushNotify && !isDndActive(preference);
}
