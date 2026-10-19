/**
 * 邮件发送工具
 *
 * 发送优先级：
 * 1. RESEND_API_KEY 已配置 → 走 Resend HTTP API 真实发送（零新增依赖，fetch 实现）
 * 2. 未配置 → 维持占位行为：生产+SMTP_HOST 输出摘要日志，其余输出开发调试日志
 *
 * 设计原则：邮件为"尽力而为"——任何发送失败只记 console.error，绝不阻断业务流程。
 * 优雅降级：未配置 RESEND_API_KEY 时仅记 DB 通知，不发邮件（调用方负责 DB 通知写入）。
 *
 * 语言（2026-10-19）：每个 send* 函数都带 `locale`，文案一律经 EMAIL_MESSAGES 取，
 * 本文件不再出现任何写死的用户可见中文。locale 必须由**调用方按收件人**给出：
 *   1. 收件人有 User 行 → 用该收件人的 User.locale（唯一正确信号，cron 场景尤其如此）
 *   2. 收件人没有 User 行（典型是 invite：被邀请人还没注册）→ 用操作者的语言
 *   3. 都拿不到 → 兜底 "zh"
 * 缺省值只是为了让"暂时没接线"的调用点不崩，不是让它悄悄发中文——接线时请显式传。
 */

import { EMAIL_COLORS } from "@/lib/html-palette";
import {
  emailMsg,
  emailHtmlLang,
  emailDateLocale,
  normalizeEmailLocale,
  type EmailLocale,
} from "@/lib/email-messages";

export interface InviteEmailParams {
  to: string;
  workspaceName: string;
  inviterName: string;
  /**
   * 一次性邀请链接（/auth/signup?invite=<token>）。
   * 提供时 = 邀请未注册用户，CTA 直接指向接受邀请；
   * 缺省时 = 已注册用户直加，邮件为"已加入"通知而非邀请。
   */
  inviteUrl?: string;
  /** 已注册直加场景的登录入口（可选；缺省回退 /auth/login） */
  loginUrl?: string;
  /** 收件人语言。未注册受邀者没有 User 行，此时传邀请人的语言。 */
  locale?: EmailLocale;
}

/** 密码重置邮件参数 */
export interface ResetPasswordEmailParams {
  to: string;
  /** 一次性重置链接（含 token，短期有效） */
  resetUrl: string;
  locale?: EmailLocale;
}

/** 邮箱验证邮件参数 */
export interface VerifyEmailParams {
  to: string;
  /** 一次性验证链接（含 token，24 小时有效） */
  verifyUrl: string;
  locale?: EmailLocale;
}

/** 任务指派通知邮件参数 */
export interface TaskAssignedEmailParams {
  to: string;
  assigneeName: string;
  taskTitle: string;
  workspaceName: string;
  assignerName: string;
  taskUrl: string;
  locale?: EmailLocale;
}

/** 截止日提醒邮件参数 */
export interface TaskDueReminderEmailParams {
  to: string;
  assigneeName: string;
  taskTitle: string;
  workspaceName: string;
  dueDate: string; // ISO 字符串
  taskUrl: string;
  locale?: EmailLocale;
}

/** @提及通知邮件参数 */
export interface MentionEmailParams {
  to: string;
  mentioneeName: string;
  taskTitle: string;
  workspaceName: string;
  mentionerName: string;
  commentSnippet: string; // 评论内容摘要（已截断）
  taskUrl: string;
  locale?: EmailLocale;
}

/** 账户删除通知邮件参数 */
export interface AccountDeletedEmailParams {
  to: string;
  /** 随账户一并删除的自有工作区数 */
  deletedWorkspaces: number;
  locale?: EmailLocale;
}

/** 每周任务摘要邮件参数 */
export interface WeeklyDigestEmailParams {
  to: string;
  memberName: string;
  workspaceName: string;
  /** 已逾期任务（未完成且截止日已过） */
  overdueTasks: { title: string; dueDate: string; taskUrl: string }[];
  /** 未来 7 天到期任务 */
  upcomingTasks: { title: string; dueDate: string; taskUrl: string }[];
  /** 本周运营漏斗（可选：不传则邮件中不渲染该段） */
  weeklyStats?: { registers: number; activations: number; taskCreates: number; pageViews: number };
  /** 工作区首页链接 */
  workspaceUrl: string;
  locale?: EmailLocale;
}

/** HTML 转义（用户可控输入，防邮件内容注入） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 强调片段：文案表里只有纯文本，加粗由渲染侧在填充占位符时包（见 email-messages.ts 约定 2）。 */
function strong(s: string): string {
  return `<strong>${s}</strong>`;
}

/**
 * 邮箱地址脱敏（R8D-01：防止 PII 泄漏到日志）。
 * 保留域名便于排障（区分内/外部域），本地部分仅留前 2 字符 + ***。
 * 例：john.doe@example.com → jo***@example.com；ab@x.com → ***@x.com
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const maskedLocal = local.length <= 2 ? "***" : local.slice(0, 2) + "***";
  return `${maskedLocal}@${domain}`;
}

/** 邮件基础模板：标题 + 正文 + CTA 链接，简洁风格，无外部 CSS 依赖。 */
function renderEmailHtml(opts: {
  locale: EmailLocale;
  title: string;
  preheader?: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaHref: string;
}): string {
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>`
    : "";
  return (
    `<!DOCTYPE html><html lang="${emailHtmlLang(opts.locale)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(opts.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${EMAIL_COLORS.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${EMAIL_COLORS.titleFg};">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_COLORS.pageBg};">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid ${EMAIL_COLORS.border};overflow:hidden;">` +
    `<tr><td style="padding:24px 32px 8px;"><h1 style="margin:0;font-size:18px;font-weight:600;line-height:1.4;color:${EMAIL_COLORS.titleFg};">${escapeHtml(opts.title)}</h1></td></tr>` +
    `<tr><td style="padding:8px 32px 24px;font-size:14px;line-height:1.6;color:${EMAIL_COLORS.bodyFg};">${opts.bodyHtml}</td></tr>` +
    `<tr><td style="padding:0 32px 32px;">` +
    `<a href="${escapeHtml(opts.ctaHref)}" style="display:inline-block;padding:10px 20px;background:${EMAIL_COLORS.accent};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">${escapeHtml(opts.ctaLabel)}</a>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 32px 24px;border-top:1px solid ${EMAIL_COLORS.border};font-size:12px;color:${EMAIL_COLORS.footerFg};">${escapeHtml(emailMsg("shellFooter", opts.locale))}</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

function renderInviteHtml(params: InviteEmailParams): string {
  const locale = normalizeEmailLocale(params.locale);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // 未注册受邀者：CTA 即接受邀请（token 一次性、7 天有效）；
  // 已注册直加：无邀请 token，邮件改为"已加入"通知，CTA 指向登录
  const pending = Boolean(params.inviteUrl);
  const title = emailMsg("inviteSubject", locale, {
    inviter: params.inviterName,
    workspace: params.workspaceName,
  });
  return renderEmailHtml({
    locale,
    title,
    preheader: title,
    bodyHtml: pending
      ? `<p style="margin:0 0 12px;">${emailMsg("invitePendingBody1", locale, { inviter: escapeHtml(params.inviterName), workspace: strong(escapeHtml(params.workspaceName)) })}</p>` +
        `<p style="margin:0;">${escapeHtml(emailMsg("invitePendingBody2", locale))}</p>`
      : `<p style="margin:0 0 12px;">${emailMsg("inviteJoinedBody1", locale, { inviter: escapeHtml(params.inviterName), workspace: strong(escapeHtml(params.workspaceName)) })}</p>` +
        `<p style="margin:0;">${escapeHtml(emailMsg("inviteJoinedBody2", locale))}</p>`,
    ctaLabel: pending ? emailMsg("ctaAcceptInvite", locale) : emailMsg("ctaSignInCorps", locale),
    ctaHref: params.inviteUrl ?? params.loginUrl ?? `${appUrl}/auth/login`,
  });
}

function renderTaskAssignedHtml(params: TaskAssignedEmailParams): string {
  const locale = normalizeEmailLocale(params.locale);
  return renderEmailHtml({
    locale,
    title: emailMsg("taskAssignedSubject", locale, {
      assigner: params.assignerName,
      task: params.taskTitle,
    }),
    preheader: emailMsg("taskAssignedPreheader", locale, { task: params.taskTitle }),
    bodyHtml:
      `<p style="margin:0 0 12px;">${emailMsg("taskAssignedBody1", locale, { assigner: escapeHtml(params.assignerName), workspace: strong(escapeHtml(params.workspaceName)) })}</p>` +
      `<p style="margin:0 0 12px;padding:12px 16px;background:${EMAIL_COLORS.quoteBg};border-radius:8px;font-size:14px;">${strong(escapeHtml(params.taskTitle))}</p>` +
      `<p style="margin:0;">${escapeHtml(emailMsg("taskAssignedBody2", locale))}</p>`,
    ctaLabel: emailMsg("ctaViewTask", locale),
    ctaHref: params.taskUrl,
  });
}

function renderTaskDueReminderHtml(params: TaskDueReminderEmailParams): string {
  const locale = normalizeEmailLocale(params.locale);
  const dueText = new Date(params.dueDate).toLocaleDateString(emailDateLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return renderEmailHtml({
    locale,
    title: emailMsg("dueReminderSubject", locale, { task: params.taskTitle }),
    preheader: emailMsg("dueReminderPreheader", locale, { task: params.taskTitle }),
    bodyHtml:
      `<p style="margin:0 0 12px;">${emailMsg("dueReminderBody1", locale, { workspace: strong(escapeHtml(params.workspaceName)) })}</p>` +
      `<p style="margin:0 0 12px;padding:12px 16px;background:${EMAIL_COLORS.warnBg};border-radius:8px;font-size:14px;">${strong(escapeHtml(params.taskTitle))}</p>` +
      `<p style="margin:0 0 12px;">${emailMsg("dueReminderDueDate", locale, { due: strong(escapeHtml(dueText)) })}</p>` +
      `<p style="margin:0;">${escapeHtml(emailMsg("dueReminderBody2", locale))}</p>`,
    ctaLabel: emailMsg("ctaViewTask", locale),
    ctaHref: params.taskUrl,
  });
}

function renderMentionHtml(params: MentionEmailParams): string {
  const locale = normalizeEmailLocale(params.locale);
  return renderEmailHtml({
    locale,
    title: emailMsg("mentionSubject", locale, {
      mentioner: params.mentionerName,
      task: params.taskTitle,
    }),
    preheader: emailMsg("mentionPreheader", locale, {
      mentioner: params.mentionerName,
      task: params.taskTitle,
    }),
    bodyHtml:
      `<p style="margin:0 0 12px;">${emailMsg("mentionBody1", locale, { mentioner: escapeHtml(params.mentionerName), workspace: strong(escapeHtml(params.workspaceName)) })}</p>` +
      `<p style="margin:0 0 12px;padding:12px 16px;background:${EMAIL_COLORS.quoteBg};border-radius:8px;font-size:14px;color:${EMAIL_COLORS.quoteFg};">${escapeHtml(params.commentSnippet)}</p>` +
      `<p style="margin:0 0 12px;">${strong(escapeHtml(params.taskTitle))}</p>` +
      `<p style="margin:0;">${escapeHtml(emailMsg("mentionBody2", locale))}</p>`,
    ctaLabel: emailMsg("ctaViewComment", locale),
    ctaHref: params.taskUrl,
  });
}

function renderResetPasswordHtml(params: ResetPasswordEmailParams): string {
  const locale = normalizeEmailLocale(params.locale);
  return renderEmailHtml({
    locale,
    title: emailMsg("resetSubject", locale),
    preheader: emailMsg("resetPreheader", locale),
    bodyHtml:
      `<p style="margin:0 0 12px;">${emailMsg("resetBody1", locale, { expiry: strong(escapeHtml(emailMsg("resetExpiry", locale))) })}</p>` +
      `<p style="margin:0;color:${EMAIL_COLORS.noteFg};">${escapeHtml(emailMsg("resetBody2", locale))}</p>`,
    ctaLabel: emailMsg("ctaResetPassword", locale),
    ctaHref: params.resetUrl,
  });
}

/** 邮件是否可用：RESEND_API_KEY 已配置时为 true。调用方可据此决定是否走邮件分支。 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

// R9D-13：生产环境 from 缺省值警告去重标志，避免每封邮件都刷一条相同的 warn
let fromDefaultWarned = false;

/**
 * 通过 Resend HTTP API 发送邮件的底层函数。
 * 失败尽力而为：任何错误只记 console.error，不抛出。
 */
async function sendViaResend(opts: {
  to: string;
  subject: string;
  html: string;
  logTag: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  try {
    // M23 修复：外部 HTTP 调用添加 30s 超时（AbortController）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      // docker-compose.yml / .env.example 定义的变量名是 EMAIL_FROM；
      // MAIL_FROM 为历史兼容（email.ts 旧版曾读此名），优先级低于 EMAIL_FROM
      const from = process.env.EMAIL_FROM ?? process.env.MAIL_FROM ?? "noreply@corps.app";
      // R9D-13 修复：生产环境 from 缺省值（未配置 EMAIL_FROM / MAIL_FROM）时
      // console.warn，避免生产环境用硬编码 noreply@corps.app 发邮件导致
      // SPF/DKIM 校验失败、邮件被判垃圾或发件人不可达。模块级标志去重，仅警告一次。
      if (
        !fromDefaultWarned &&
        process.env.NODE_ENV === "production" &&
        !process.env.EMAIL_FROM &&
        !process.env.MAIL_FROM
      ) {
        fromDefaultWarned = true;
        console.warn(
          "[email] 生产环境未配置 EMAIL_FROM / MAIL_FROM，使用缺省发件人 noreply@corps.app，" +
            "可能导致 SPF/DKIM 校验失败或邮件被判垃圾，请配置 EMAIL_FROM 环境变量",
        );
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      console.info(`[email] ${opts.logTag} sent to ${maskEmail(opts.to)}`);
      return true;
    } finally {
      // L1 修复：确保超时 timer 在任何情况下都被清理，防止 timer handle 泄漏
      clearTimeout(timeoutId);
    }
  } catch (err) {
    console.error(`[email] ${opts.logTag} send failed (non-blocking):`, err);
    return false;
  }
}

/** 占位路径：未配置 Resend 时输出日志（生产+SMTP_HOST 输出摘要，其余输出开发调试） */
function logPlaceholder(tag: string, detail: string): void {
  if (process.env.NODE_ENV === "production" && process.env.SMTP_HOST) {
    console.info(`[email] ${tag} sent (${detail})`);
  } else {
    console.info(`[email-dev] ${tag}: ${detail}`);
  }
}

export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  const locale = normalizeEmailLocale(params.locale);
  const sent = await sendViaResend({
    to: params.to,
    subject: emailMsg("inviteSubject", locale, {
      inviter: params.inviterName,
      workspace: params.workspaceName,
    }),
    html: renderInviteHtml(params),
    logTag: "invite",
  });
  // 已配置 Resend 但发送失败时不再打占位日志：失败已有 console.error，
  // 再打 "sent" 会造成误导（也符合"失败无成功日志"的测试口径）
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "invite",
      `to=${maskEmail(params.to)}, workspace=${params.workspaceName}, inviter=${params.inviterName}`,
    );
  }
}

/** 任务指派通知邮件（失败不阻塞，返回是否真实发送） */
export async function sendTaskAssignedEmail(params: TaskAssignedEmailParams): Promise<boolean> {
  const locale = normalizeEmailLocale(params.locale);
  const sent = await sendViaResend({
    to: params.to,
    subject: emailMsg("taskAssignedSubject", locale, {
      assigner: params.assignerName,
      task: params.taskTitle,
    }),
    html: renderTaskAssignedHtml(params),
    logTag: "task_assigned",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "task_assigned",
      `to=${maskEmail(params.to)}, task=${params.taskTitle}, assigner=${params.assignerName}`,
    );
  }
  return sent;
}

/** 截止日提醒邮件（失败不阻塞，返回是否真实发送） */
export async function sendTaskDueReminderEmail(
  params: TaskDueReminderEmailParams,
): Promise<boolean> {
  const locale = normalizeEmailLocale(params.locale);
  const sent = await sendViaResend({
    to: params.to,
    subject: emailMsg("dueReminderSubject", locale, { task: params.taskTitle }),
    html: renderTaskDueReminderHtml(params),
    logTag: "task_due_reminder",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "task_due_reminder",
      `to=${maskEmail(params.to)}, task=${params.taskTitle}, due=${params.dueDate}`,
    );
  }
  return sent;
}

/** @提及通知邮件（失败不阻塞，返回是否真实发送） */
export async function sendMentionEmail(params: MentionEmailParams): Promise<boolean> {
  const locale = normalizeEmailLocale(params.locale);
  const sent = await sendViaResend({
    to: params.to,
    subject: emailMsg("mentionSubject", locale, {
      mentioner: params.mentionerName,
      task: params.taskTitle,
    }),
    html: renderMentionHtml(params),
    logTag: "mention",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "mention",
      `to=${maskEmail(params.to)}, task=${params.taskTitle}, mentioner=${params.mentionerName}`,
    );
  }
  return sent;
}

/** 密码重置邮件（由 Better Auth 的 sendResetPassword 回调触发，失败不阻塞） */
export async function sendResetPasswordEmail(params: ResetPasswordEmailParams): Promise<void> {
  const locale = normalizeEmailLocale(params.locale);
  const sent = await sendViaResend({
    to: params.to,
    subject: emailMsg("resetSubject", locale),
    html: renderResetPasswordHtml(params),
    logTag: "reset_password",
  });
  if (!sent && !isEmailConfigured()) {
    // 未配置 Resend 时仅记录收件人（S12：不记录 resetUrl/token，避免日志泄露凭据）
    logPlaceholder("reset_password", `to=${maskEmail(params.to)}`);
  }
}

function renderVerifyEmailHtml(params: VerifyEmailParams): string {
  const locale = normalizeEmailLocale(params.locale);
  return renderEmailHtml({
    locale,
    title: emailMsg("verifySubject", locale),
    preheader: emailMsg("verifyPreheader", locale),
    bodyHtml:
      `<p style="margin:0 0 12px;">${escapeHtml(emailMsg("verifyBody1", locale))}</p>` +
      `<p style="margin:0 0 12px;">${emailMsg("verifyBody2", locale, { expiry: strong(escapeHtml(emailMsg("verifyExpiry", locale))) })}</p>` +
      `<p style="margin:0;color:${EMAIL_COLORS.noteFg};">${escapeHtml(emailMsg("verifyBody3", locale))}</p>`,
    ctaLabel: emailMsg("ctaVerifyEmail", locale),
    ctaHref: params.verifyUrl,
  });
}

/**
 * 邮箱验证邮件（由注册流程 / Better Auth sendVerificationEmail 回调触发，失败不阻塞）。
 * 未配置 Resend 时仅记录收件人（不记录 verifyUrl/token，避免日志泄露凭据）。
 */
export async function sendVerificationEmail(params: VerifyEmailParams): Promise<void> {
  const locale = normalizeEmailLocale(params.locale);
  const sent = await sendViaResend({
    to: params.to,
    subject: emailMsg("verifySubject", locale),
    html: renderVerifyEmailHtml(params),
    logTag: "verify_email",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder("verify_email", `to=${maskEmail(params.to)}`);
  }
}

function renderAccountDeletedHtml(params: AccountDeletedEmailParams): string {
  const locale = normalizeEmailLocale(params.locale);
  return renderEmailHtml({
    locale,
    title: emailMsg("deletedSubject", locale),
    preheader: emailMsg("deletedPreheader", locale),
    bodyHtml:
      `<p style="margin:0 0 12px;">${escapeHtml(emailMsg("deletedBody1", locale))}</p>` +
      `<p style="margin:0 0 12px;">${emailMsg("deletedBody2", locale, { count: params.deletedWorkspaces, workspaces: strong(escapeHtml(emailMsg("deletedOwnWorkspaces", locale))) })}</p>` +
      `<p style="margin:0;">${escapeHtml(emailMsg("deletedBody3", locale))}</p>`,
    // 账户已删，没有站内页面可跳——CTA 去登录页（重新注册入口）
    ctaLabel: emailMsg("ctaRevisitCorps", locale),
    ctaHref: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/login`,
  });
}

/** 账户删除通知邮件（阶段 2-3；尽力而为，失败不阻塞删除主流程） */
export async function sendAccountDeletedEmail(params: AccountDeletedEmailParams): Promise<void> {
  const locale = normalizeEmailLocale(params.locale);
  const sent = await sendViaResend({
    to: params.to,
    subject: emailMsg("deletedSubject", locale),
    html: renderAccountDeletedHtml(params),
    logTag: "account_deleted",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder("account_deleted", `to=${maskEmail(params.to)}, ws=${params.deletedWorkspaces}`);
  }
}

// ─── 每周任务摘要（Pro 功能，v2 定价 2026-09-02）───────────────────────────

/** 每周摘要的任务列表行（标题 + 截止日 + 链接） */
function digestTaskRows(
  tasks: WeeklyDigestEmailParams["overdueTasks"],
  warn: boolean,
  locale: EmailLocale,
): string {
  if (tasks.length === 0) return "";
  const color = warn ? EMAIL_COLORS.warnBg : EMAIL_COLORS.infoBg;
  const dateLocale = emailDateLocale(locale);
  return tasks
    .slice(0, 10)
    .map(
      (t) =>
        `<p style="margin:0 0 8px;padding:10px 14px;background:${color};border-radius:8px;font-size:14px;">` +
        `${strong(escapeHtml(t.title))} · ${escapeHtml(new Date(t.dueDate).toLocaleDateString(dateLocale, { month: "long", day: "numeric" }))}</p>`,
    )
    .join("");
}

/** 每周任务摘要邮件 HTML */
function renderWeeklyDigestHtml(params: WeeklyDigestEmailParams): string {
  const locale = normalizeEmailLocale(params.locale);
  const name = escapeHtml(params.memberName || emailMsg("digestFallbackName", locale));
  const hasAny = params.overdueTasks.length > 0 || params.upcomingTasks.length > 0;
  return renderEmailHtml({
    locale,
    title: emailMsg("digestTitle", locale, { workspace: params.workspaceName }),
    preheader: emailMsg("digestPreheader", locale, {
      overdue: params.overdueTasks.length,
      upcoming: params.upcomingTasks.length,
    }),
    bodyHtml:
      `<p style="margin:0 0 12px;">${emailMsg("digestGreeting", locale, { name, workspace: strong(escapeHtml(params.workspaceName)) })}</p>` +
      (params.overdueTasks.length > 0
        ? `<p style="margin:16px 0 8px;font-weight:600;color:${EMAIL_COLORS.overdueFg};">${escapeHtml(emailMsg("digestOverdueHeading", locale, { count: params.overdueTasks.length }))}</p>` +
          digestTaskRows(params.overdueTasks, true, locale)
        : "") +
      (params.upcomingTasks.length > 0
        ? `<p style="margin:16px 0 8px;font-weight:600;color:${EMAIL_COLORS.accent};">${escapeHtml(emailMsg("digestUpcomingHeading", locale, { count: params.upcomingTasks.length }))}</p>` +
          digestTaskRows(params.upcomingTasks, false, locale)
        : "") +
      (!hasAny
        ? `<p style="margin:0 0 12px;">${escapeHtml(emailMsg("digestAllClear", locale))}</p>`
        : "") +
      `<p style="margin:16px 0 0;color:${EMAIL_COLORS.footnoteFg};font-size:13px;">${escapeHtml(emailMsg("digestTruncationNote", locale))}</p>` +
      (params.weeklyStats
        ? `<p style="margin:20px 0 6px;font-weight:600;color:${EMAIL_COLORS.accent};">${escapeHtml(emailMsg("digestStatsHeading", locale))}</p>` +
          `<p style="margin:0 0 12px;padding:10px 14px;background:${EMAIL_COLORS.infoBg};border-radius:8px;font-size:13px;">` +
          `${escapeHtml(
            emailMsg("digestStatsLine", locale, {
              registers: params.weeklyStats.registers,
              activations: params.weeklyStats.activations,
              taskCreates: params.weeklyStats.taskCreates,
              pageViews: params.weeklyStats.pageViews,
            }),
          )}</p>`
        : ""),
    ctaLabel: emailMsg("ctaOpenWorkspace", locale),
    ctaHref: params.workspaceUrl,
  });
}

/** 每周任务摘要邮件（失败不阻塞，返回是否真实发送） */
export async function sendWeeklyDigestEmail(params: WeeklyDigestEmailParams): Promise<boolean> {
  const locale = normalizeEmailLocale(params.locale);
  const sent = await sendViaResend({
    to: params.to,
    subject: emailMsg("digestSubject", locale, {
      workspace: params.workspaceName,
      overdue: params.overdueTasks.length,
      upcoming: params.upcomingTasks.length,
    }),
    html: renderWeeklyDigestHtml(params),
    logTag: "weekly_digest",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "weekly_digest",
      `to=${maskEmail(params.to)}, overdue=${params.overdueTasks.length}, upcoming=${params.upcomingTasks.length}`,
    );
  }
  return sent;
}
