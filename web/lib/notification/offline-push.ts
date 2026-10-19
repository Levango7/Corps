// 离线消息推送库
//
// 核心职责：当用户离线时，将通知通过邮件派发，并始终创建应用内通知记录。
// 在线用户通过 WebSocket 实时收到通知，无需邮件推送。
//
// 认证/事务模式：
//  - isUserOnline：跨工作区查询 ChatPresence，走 runWithAuthOp("cron") 逃逸通道
//  - NotificationPreference：用户级数据（无 workspaceId），经 lib/notification/preferences.ts 读取
//  - EmailAccount / Notification：工作区级，走 runWithWorkspace（RLS 事务）
//
// 经验来源：2026-09-15-ai-route-unified-pattern-audit-checklist
//  - DB 操作用 try-catch 包裹，失败不阻断业务流程

import { runWithWorkspace, runWithAuthOp } from "@/lib/auth";
import { getNotificationPreferences, isDndActive } from "@/lib/notification/preferences";
import { decrypt } from "@/lib/crypto";
import { EMAIL_COLORS } from "@/lib/html-palette";
import { emailMsg, normalizeEmailLocale, type EmailLocale } from "@/lib/email-messages";
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
  // 逾期行动项通知由 cron check-overdue-actions 落库，但此前不在白名单里，
  // 导致该点位无法复用离线扇出（接不上类型）。
  "action_overdue",
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

/**
 * 构建离线通知邮件的主题与正文。
 *
 * locale 由 fanOutOfflineEmail 按收件人的 User.locale 取（本模块的调用点之一是
 * cron check-overdue-actions，那里没有 request 可协商语言）。
 * 注意 entityTitle / bodySnippet 是调用方给的内容——调用方若在 cron 里写死中文，
 * 它仍会原样出现在邮件里；判定级联只管模板自身的固定文案。
 */
function buildEmailContent(
  opts: DispatchOfflineNotificationOpts,
  locale: EmailLocale,
): {
  subject: string;
  text: string;
  html: string;
} {
  const actor = opts.actorName ?? emailMsg("offlineActorSystem", locale);
  const snippet = opts.bodySnippet ?? "";
  const subject = emailMsg("offlineSubject", locale, {
    actor,
    title: opts.entityTitle,
  });
  const text =
    emailMsg("offlineUpdateLine", locale, { actor, title: opts.entityTitle }) +
    `${snippet}\n\n${emailMsg("offlineSignInHint", locale)}`;
  const html =
    `<p style="margin:0 0 12px;">${emailMsg("offlineUpdateLine", locale, { actor: strongHtml(actor), title: strongHtml(opts.entityTitle) })}</p>` +
    (snippet
      ? `<p style="margin:0 0 12px;color:${EMAIL_COLORS.quoteFg};">${escapeHtml(snippet)}</p>`
      : "") +
    `<p style="margin:0;">${escapeHtml(emailMsg("offlineSignInHint", locale))}</p>`;
  return { subject, text, html };
}

/** <strong> 包装：文案表里只有纯文本，加粗由渲染侧在填充占位符时包。 */
function strongHtml(s: string): string {
  return `<strong>${escapeHtml(s)}</strong>`;
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
 * 只做"离线扇出"：判在线 → 读偏好 → 判 DND → 需要时发邮件。
 * **不写 Notification 记录**。
 *
 * 为什么要有这个入口：仓库里另有 21 处通知落库点（19 处 tx.notification.create + 2 处
 * createMany，分布在 19 个文件）在自己的事务里写 Notification 行，
 * 让它们直接调 dispatchOfflineNotification 会重复落一条记录。这些调用点只需要
 * "在事务提交之后补一次离线扇出"，所以把扇出单独拆出来。
 * 调用位置必须在事务外：sendOfflineEmail 是 SMTP 网络 IO，挂在 RLS 事务里会长时间
 * 占用连接并把事务隔离窗口拉到网络往返上。
 */
export async function fanOutOfflineEmail(opts: DispatchOfflineNotificationOpts): Promise<void> {
  // 1) 在线用户由 WebSocket/SSE 实时收到，不补邮件
  if (await isUserOnline(opts.userId)) return;

  // 2) 通知偏好（读失败回退默认值的语义在 preferences.ts 内单一实现）
  const preference = await getNotificationPreferences(opts.userId);

  // 3) DND 时段跳过
  if (isDndActive(preference)) return;

  if (!preference.emailNotify) return;

  // 4) 发送（失败不抛出，保持"尽力而为"）
  try {
    // 查询用户在工作区的默认邮箱账户，并顺带取收件人的语言。
    // 语言必须与邮箱账户同一次事务查出：本函数的主要调用点是 cron（无 request 对象），
    // User.locale 是那里唯一能决定邮件语言的信号，没有第二条路可读。
    const { emailAccount, locale } = await runWithWorkspace(
      opts.workspaceId,
      async (tx) => {
        const account = await tx.emailAccount.findFirst({
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
        });
        // users 表不在 RLS 范围内（同事务查询无碍），读不到时按 zh 兜底
        const user = await tx.user
          .findUnique({ where: { id: opts.userId }, select: { locale: true } })
          .catch(() => null);
        return { emailAccount: account, locale: normalizeEmailLocale(user?.locale) };
      },
      opts.userId,
    );

    if (emailAccount) {
      const content = buildEmailContent(opts, locale);
      await sendOfflineEmail(emailAccount, content.subject, content.text, content.html);
    }
  } catch (error) {
    console.error("[offline-push] email dispatch error (non-blocking):", error);
  }
}

/**
 * 派发离线通知（落记录 + 离线扇出）。
 *
 * 只给"自己不落通知记录"的调用方用；已经在自己的事务里 `notification.create`
 * 的调用点请改用 `fanOutOfflineEmail`，否则会重复落一条记录。
 */
export async function dispatchOfflineNotification(
  opts: DispatchOfflineNotificationOpts,
): Promise<void> {
  // 始终创建 Notification 记录（应用内通知，上线后可见）
  await createNotificationRecord(opts);
  // 再按在线状态/偏好/DND 决定是否补邮件
  await fanOutOfflineEmail(opts);
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
