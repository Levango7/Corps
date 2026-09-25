// 离线消息推送库
//
// 核心职责：当用户离线时，将通知通过邮件派发，并始终创建应用内通知记录。
// 在线用户通过 WebSocket 实时收到通知，无需邮件推送。
//
// 认证/事务模式：
//  - isUserOnline：跨工作区查询 ChatPresence，走 runWithAuthOp("cron") 逃逸通道
//  - NotificationPreference：用户级数据（无 workspaceId），直接 prisma
//  - EmailAccount / Notification：工作区级，走 runWithWorkspace（RLS 事务）
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - DB 操作用 try-catch 包裹，失败不阻断业务流程

import { prisma } from "@/lib/prisma";
import { runWithWorkspace, runWithAuthOp } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import nodemailer, { type Transporter } from "nodemailer";

/** 在线判定阈值：lastSeen 在此毫秒数内视为在线（容忍一次心跳丢失） */
const ONLINE_THRESHOLD_MS = 60_000;

/** 通知类型白名单（与 Prisma Notification.type 注释一致） */
export const NOTIFICATION_TYPES = [
  "mention",
  "task_assigned",
  "task_updated",
  "comment_added",
  "decision_updated",
] as const;

/** 派发离线通知的参数 */
export interface DispatchOfflineNotificationOpts {
  /** 接收通知的用户 ID */
  userId: string;
  /** 工作区 ID */
  workspaceId: string;
  /** 通知类型 */
  type: (typeof NOTIFICATION_TYPES)[number];
  /** 关联实体 ID（如任务 ID） */
  entityId: string;
  /** 关联实体标题（冗余存储，通知中心展示） */
  entityTitle: string;
  /** 触发者名称（用于邮件正文，可选） */
  actorName?: string;
  /** 通知正文摘要（用于邮件正文，可选） */
  bodySnippet?: string;
}

/** NotificationPreference 的 DND 相关字段子集 */
interface DndPreference {
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
}

/**
 * 检查用户是否在线：任何 ChatPresence 记录的 lastSeen 在 60s 内即视为在线。
 * 跨工作区查询，走 runWithAuthOp("cron") 系统级逃逸通道（不受 RLS 约束）。
 */
export async function isUserOnline(userId: string): Promise<boolean> {
  const threshold = new Date(Date.now() - ONLINE_THRESHOLD_MS);
  try {
    const presence = await runWithAuthOp(
      "cron",
      async (tx) =>
        tx.chatPresence.findFirst({
          where: {
            userId,
            lastSeen: { gte: threshold },
          },
          select: { id: true },
        }),
      userId,
    );
    return !!presence;
  } catch (error) {
    console.error("[offline-push] isUserOnline error:", error);
    // 查询失败时保守视为离线，确保通知不丢失
    return false;
  }
}

/**
 * 检查当前时间是否在免打扰时段。
 * 支持跨午夜区间（如 dndStart=22:00, dndEnd=08:00）。
 *
 * @param preference 包含 dndEnabled / dndStart / dndEnd 的偏好对象
 * @returns true 表示当前处于 DND 时段，应抑制推送
 */
export function isDndActive(preference: DndPreference): boolean {
  if (!preference.dndEnabled) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const startParts = preference.dndStart.split(":").map(Number);
  const endParts = preference.dndEnd.split(":").map(Number);
  const startMinutes = (startParts[0] ?? 0) * 60 + (startParts[1] ?? 0);
  const endMinutes = (endParts[0] ?? 0) * 60 + (endParts[1] ?? 0);

  // 起止相同 → 空区间，不抑制
  if (startMinutes === endMinutes) return false;

  if (startMinutes < endMinutes) {
    // 同日区间，如 09:00-18:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // 跨午夜区间，如 22:00-08:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

/**
 * 通过用户的 EmailAccount SMTP 配置发送离线通知邮件。
 * 失败尽力而为：任何错误只记 console.error，不抛出。
 *
 * credential 字段为 AES-256 加密存储，此处用 decrypt 解密后作为 SMTP 密码。
 */
async function sendOfflineEmail(
  emailAccount: {
    email: string;
    displayName: string | null;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    credential: string;
  },
  subject: string,
  textBody: string,
  htmlBody: string,
): Promise<boolean> {
  // P1-fix: transporter 必须在 finally 中 close，防 SMTP 连接泄漏
  let transporter: Transporter | null = null;
  try {
    const password = decrypt(emailAccount.credential);
    transporter = nodemailer.createTransport({
      host: emailAccount.smtpHost,
      port: emailAccount.smtpPort,
      secure: emailAccount.smtpSecure,
      auth: {
        user: emailAccount.email,
        pass: password,
      },
    });
    await transporter.sendMail({
      from: emailAccount.displayName
        ? `${emailAccount.displayName} <${emailAccount.email}>`
        : emailAccount.email,
      to: emailAccount.email,
      subject,
      text: textBody,
      html: htmlBody,
    });
    console.info(
      `[offline-push] email sent to ${emailAccount.email.slice(0, 2)}***@${emailAccount.email.split("@")[1]}`,
    );
    return true;
  } catch (error) {
    console.error("[offline-push] email send failed (non-blocking):", error);
    return false;
  } finally {
    // P1-fix: 无论成功或失败都关闭 SMTP 连接，防连接泄漏
    transporter?.close();
  }
}

/** 构建离线通知邮件的主题与正文 */
function buildEmailContent(opts: DispatchOfflineNotificationOpts): {
  subject: string;
  text: string;
  html: string;
} {
  const actor = opts.actorName ?? "系统";
  const snippet = opts.bodySnippet ?? "";
  const subject = `${actor}：${opts.entityTitle}`;
  const text = `${actor} 在 ${opts.entityTitle} 中有新动态。${snippet}\n\n请登录查看详情。`;
  const html =
    `<p style="margin:0 0 12px;"><strong>${escapeHtml(actor)}</strong> 在 <strong>${escapeHtml(opts.entityTitle)}</strong> 中有新动态。</p>` +
    (snippet ? `<p style="margin:0 0 12px;color:#475569;">${escapeHtml(snippet)}</p>` : "") +
    `<p style="margin:0;">请登录查看详情。</p>`;
  return { subject, text, html };
}

/** HTML 转义（防邮件内容注入） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 派发离线通知。
 *
 * 决策流程：
 *  1. 检查用户在线状态 → 在线则跳过邮件推送（WebSocket 已实时收到）
 *  2. 获取通知偏好（不存在则用默认值）
 *  3. 检查 DND 时段 → DND 时段跳过邮件推送
 *  4. 离线 && 非DND && emailNotify → 发送邮件（需有 EmailAccount）
 *  5. 始终创建 Notification 记录（应用内通知，上线后可见）
 *
 * 邮件发送失败不阻断 Notification 记录创建。
 */
export async function dispatchOfflineNotification(
  opts: DispatchOfflineNotificationOpts,
): Promise<void> {
  // 1) 检查在线状态
  const online = await isUserOnline(opts.userId);
  if (online) {
    // 在线：WebSocket 已实时推送，仅创建通知记录（通知中心可见）
    await createNotificationRecord(opts);
    return;
  }

  // 2) 获取通知偏好（用户级，直接 prisma）
  let preference: {
    emailNotify: boolean;
    pushNotify: boolean;
    dndEnabled: boolean;
    dndStart: string;
    dndEnd: string;
  };
  try {
    preference = await prisma.notificationPreference.upsert({
      where: { userId: opts.userId },
      create: { userId: opts.userId },
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
    console.error("[offline-push] get preference error:", error);
    // 查询失败用默认值，确保通知不丢失
    preference = {
      emailNotify: true,
      pushNotify: true,
      dndEnabled: false,
      dndStart: "22:00",
      dndEnd: "08:00",
    };
  }

  // 3) 检查 DND 时段
  const dndActive = isDndActive(preference);

  // 4) 离线 && 非DND && emailNotify → 发送邮件
  if (!dndActive && preference.emailNotify) {
    try {
      // 查询用户在工作区的默认邮箱账户
      const emailAccount = await runWithWorkspace(
        opts.workspaceId,
        (tx) =>
          tx.emailAccount.findFirst({
            where: {
              workspaceId: opts.workspaceId,
              userId: opts.userId,
              isDefault: true,
            },
            select: {
              email: true,
              displayName: true,
              smtpHost: true,
              smtpPort: true,
              smtpSecure: true,
              credential: true,
            },
          }),
        opts.userId,
      );

      if (emailAccount) {
        const content = buildEmailContent(opts);
        await sendOfflineEmail(emailAccount, content.subject, content.text, content.html);
      }
    } catch (error) {
      // 邮件发送失败不阻断通知记录创建
      console.error("[offline-push] email dispatch error (non-blocking):", error);
    }
  }

  // 5) 始终创建 Notification 记录
  await createNotificationRecord(opts);
}

/**
 * 创建应用内 Notification 记录（工作区级，走 RLS 事务）。
 * 失败时记错误但不抛出（尽力而为，不阻断调用方业务流程）。
 */
async function createNotificationRecord(opts: DispatchOfflineNotificationOpts): Promise<void> {
  try {
    await runWithWorkspace(
      opts.workspaceId,
      (tx) =>
        tx.notification.create({
          data: {
            userId: opts.userId,
            workspaceId: opts.workspaceId,
            type: opts.type,
            entityId: opts.entityId,
            entityTitle: opts.entityTitle,
            read: false,
          },
        }),
      opts.userId,
    );
  } catch (error) {
    console.error("[offline-push] create notification error (non-blocking):", error);
  }
}
