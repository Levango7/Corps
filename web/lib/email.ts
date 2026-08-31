/**
 * 邮件发送工具
 *
 * 发送优先级：
 * 1. RESEND_API_KEY 已配置 → 走 Resend HTTP API 真实发送（零新增依赖，fetch 实现）
 * 2. 未配置 → 维持占位行为：生产+SMTP_HOST 输出摘要日志，其余输出开发调试日志
 *
 * 设计原则：邮件为"尽力而为"——任何发送失败只记 console.error，绝不阻断业务流程。
 * 优雅降级：未配置 RESEND_API_KEY 时仅记 DB 通知，不发邮件（调用方负责 DB 通知写入）。
 */

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
}

/** 密码重置邮件参数 */
export interface ResetPasswordEmailParams {
  to: string;
  /** 一次性重置链接（含 token，短期有效） */
  resetUrl: string;
}

/** 任务指派通知邮件参数 */
export interface TaskAssignedEmailParams {
  to: string;
  assigneeName: string;
  taskTitle: string;
  workspaceName: string;
  assignerName: string;
  taskUrl: string;
}

/** 截止日提醒邮件参数 */
export interface TaskDueReminderEmailParams {
  to: string;
  assigneeName: string;
  taskTitle: string;
  workspaceName: string;
  dueDate: string; // ISO 字符串
  taskUrl: string;
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
}

/** HTML 转义（用户可控输入，防邮件内容注入） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 邮件基础模板：标题 + 正文 + CTA 链接，简洁风格，无外部 CSS 依赖。 */
function renderEmailHtml(opts: {
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
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(opts.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">` +
    `<tr><td style="padding:24px 32px 8px;"><h1 style="margin:0;font-size:18px;font-weight:600;line-height:1.4;color:#0f172a;">${escapeHtml(opts.title)}</h1></td></tr>` +
    `<tr><td style="padding:8px 32px 24px;font-size:14px;line-height:1.6;color:#334155;">${opts.bodyHtml}</td></tr>` +
    `<tr><td style="padding:0 32px 32px;">` +
    `<a href="${escapeHtml(opts.ctaHref)}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">${escapeHtml(opts.ctaLabel)}</a>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;">corps · 面向中小团队的轻量协作工具</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

function renderInviteHtml(params: InviteEmailParams): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // 未注册受邀者：CTA 即接受邀请（token 一次性、7 天有效）；
  // 已注册直加：无邀请 token，邮件改为"已加入"通知，CTA 指向登录
  const pending = Boolean(params.inviteUrl);
  const title = `${params.inviterName} 邀请你加入 ${params.workspaceName}`;
  return renderEmailHtml({
    title,
    preheader: title,
    bodyHtml: pending
      ? `<p style="margin:0 0 12px;">${escapeHtml(params.inviterName)} 邀请你加入 <strong>${escapeHtml(params.workspaceName)}</strong>。</p>` +
        `<p style="margin:0;">点击下方按钮设置密码并加入，链接 7 天内有效。</p>`
      : `<p style="margin:0 0 12px;">${escapeHtml(params.inviterName)} 将你加入了 <strong>${escapeHtml(params.workspaceName)}</strong>。</p>` +
        `<p style="margin:0;">登录后即可在任务看板中查看并开始协作。</p>`,
    ctaLabel: pending ? "接受邀请" : "登录 corps",
    ctaHref: params.inviteUrl ?? params.loginUrl ?? `${appUrl}/auth/login`,
  });
}

function renderTaskAssignedHtml(params: TaskAssignedEmailParams): string {
  return renderEmailHtml({
    title: `${params.assignerName} 给你指派了任务「${params.taskTitle}」`,
    preheader: `新任务指派：${params.taskTitle}`,
    bodyHtml:
      `<p style="margin:0 0 12px;">${escapeHtml(params.assignerName)} 在 <strong>${escapeHtml(params.workspaceName)}</strong> 中给你指派了一个任务：</p>` +
      `<p style="margin:0 0 12px;padding:12px 16px;background:#f1f5f9;border-radius:8px;font-size:14px;"><strong>${escapeHtml(params.taskTitle)}</strong></p>` +
      `<p style="margin:0;">点击下方按钮查看任务详情。</p>`,
    ctaLabel: "查看任务",
    ctaHref: params.taskUrl,
  });
}

function renderTaskDueReminderHtml(params: TaskDueReminderEmailParams): string {
  const dueText = new Date(params.dueDate).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return renderEmailHtml({
    title: `任务「${params.taskTitle}」明天到期`,
    preheader: `截止日提醒：${params.taskTitle} 明天到期`,
    bodyHtml:
      `<p style="margin:0 0 12px;">你在 <strong>${escapeHtml(params.workspaceName)}</strong> 中负责的任务即将到期：</p>` +
      `<p style="margin:0 0 12px;padding:12px 16px;background:#fef3c7;border-radius:8px;font-size:14px;"><strong>${escapeHtml(params.taskTitle)}</strong></p>` +
      `<p style="margin:0 0 12px;">截止日期：<strong>${escapeHtml(dueText)}</strong></p>` +
      `<p style="margin:0;">请尽快处理，避免逾期。</p>`,
    ctaLabel: "查看任务",
    ctaHref: params.taskUrl,
  });
}

function renderMentionHtml(params: MentionEmailParams): string {
  return renderEmailHtml({
    title: `${params.mentionerName} 在「${params.taskTitle}」中提到了你`,
    preheader: `@提及：${params.mentionerName} 在 ${params.taskTitle} 中提到了你`,
    bodyHtml:
      `<p style="margin:0 0 12px;">${escapeHtml(params.mentionerName)} 在 <strong>${escapeHtml(params.workspaceName)}</strong> 的任务评论中提到了你：</p>` +
      `<p style="margin:0 0 12px;padding:12px 16px;background:#f1f5f9;border-radius:8px;font-size:14px;color:#475569;">${escapeHtml(params.commentSnippet)}</p>` +
      `<p style="margin:0 0 12px;"><strong>${escapeHtml(params.taskTitle)}</strong></p>` +
      `<p style="margin:0;">点击下方按钮查看并回复。</p>`,
    ctaLabel: "查看评论",
    ctaHref: params.taskUrl,
  });
}

function renderResetPasswordHtml(params: ResetPasswordEmailParams): string {
  return renderEmailHtml({
    title: "重置你的 corps 密码",
    preheader: "密码重置请求：链接 1 小时内有效",
    bodyHtml:
      `<p style="margin:0 0 12px;">我们收到了你的密码重置请求。点击下方按钮设置新密码，链接 <strong>1 小时内有效</strong>。</p>` +
      `<p style="margin:0;color:#64748b;">如果不是你本人操作，可以忽略这封邮件，你的密码不会被更改。</p>`,
    ctaLabel: "重置密码",
    ctaHref: params.resetUrl,
  });
}

/** 邮件是否可用：RESEND_API_KEY 已配置时为 true。调用方可据此决定是否走邮件分支。 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

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
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // docker-compose.yml / .env.example 定义的变量名是 EMAIL_FROM；
        // MAIL_FROM 为历史兼容（email.ts 旧版曾读此名），优先级低于 EMAIL_FROM
        from: process.env.EMAIL_FROM ?? process.env.MAIL_FROM ?? "noreply@corps.app",
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    console.info(`[email] ${opts.logTag} sent to ${opts.to}`);
    return true;
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
  const sent = await sendViaResend({
    to: params.to,
    subject: `${params.inviterName} 邀请你加入 ${params.workspaceName}`,
    html: renderInviteHtml(params),
    logTag: "invite",
  });
  // 已配置 Resend 但发送失败时不再打占位日志：失败已有 console.error，
  // 再打 "sent" 会造成误导（也符合"失败无成功日志"的测试口径）
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "invite",
      `to=${params.to}, workspace=${params.workspaceName}, inviter=${params.inviterName}`,
    );
  }
}

/** 任务指派通知邮件（失败不阻塞，返回是否真实发送） */
export async function sendTaskAssignedEmail(params: TaskAssignedEmailParams): Promise<boolean> {
  const sent = await sendViaResend({
    to: params.to,
    subject: `${params.assignerName} 给你指派了任务「${params.taskTitle}」`,
    html: renderTaskAssignedHtml(params),
    logTag: "task_assigned",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "task_assigned",
      `to=${params.to}, task=${params.taskTitle}, assigner=${params.assignerName}`,
    );
  }
  return sent;
}

/** 截止日提醒邮件（失败不阻塞，返回是否真实发送） */
export async function sendTaskDueReminderEmail(
  params: TaskDueReminderEmailParams,
): Promise<boolean> {
  const sent = await sendViaResend({
    to: params.to,
    subject: `任务「${params.taskTitle}」明天到期`,
    html: renderTaskDueReminderHtml(params),
    logTag: "task_due_reminder",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "task_due_reminder",
      `to=${params.to}, task=${params.taskTitle}, due=${params.dueDate}`,
    );
  }
  return sent;
}

/** @提及通知邮件（失败不阻塞，返回是否真实发送） */
export async function sendMentionEmail(params: MentionEmailParams): Promise<boolean> {
  const sent = await sendViaResend({
    to: params.to,
    subject: `${params.mentionerName} 在「${params.taskTitle}」中提到了你`,
    html: renderMentionHtml(params),
    logTag: "mention",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder(
      "mention",
      `to=${params.to}, task=${params.taskTitle}, mentioner=${params.mentionerName}`,
    );
  }
  return sent;
}

/** 密码重置邮件（由 Better Auth 的 sendResetPassword 回调触发，失败不阻塞） */
export async function sendResetPasswordEmail(params: ResetPasswordEmailParams): Promise<void> {
  const sent = await sendViaResend({
    to: params.to,
    subject: "重置你的 corps 密码",
    html: renderResetPasswordHtml(params),
    logTag: "reset_password",
  });
  if (!sent && !isEmailConfigured()) {
    // 未配置 Resend 时把重置链接打到日志，本地开发仍可走通重置流程
    logPlaceholder("reset_password", `to=${params.to}, resetUrl=${params.resetUrl}`);
  }
}

/** 账户删除通知邮件参数 */
export interface AccountDeletedEmailParams {
  to: string;
  /** 随账户一并删除的自有工作区数 */
  deletedWorkspaces: number;
}

function renderAccountDeletedHtml(params: AccountDeletedEmailParams): string {
  return renderEmailHtml({
    title: "你的 corps 账户已删除",
    preheader: "账户删除确认通知",
    bodyHtml:
      `<p style="margin:0 0 12px;">我们确认你的 corps 账户及关联数据已删除完毕。</p>` +
      `<p style="margin:0 0 12px;">随账户一并删除的<b>自有工作区</b>共 ${params.deletedWorkspaces} 个（含其任务、决策、聊天与附件记录）；你曾作为成员加入的其他工作区不受影响，仅移除了你的成员身份。</p>` +
      `<p style="margin:0;">如果这是误操作或你有任何疑问，请在 7 天内联系支持邮箱——部分数据可能仍有备份可恢复（见隐私政策）。</p>`,
    // 账户已删，没有站内页面可跳——CTA 去登录页（重新注册入口）
    ctaLabel: "重新访问 corps",
    ctaHref: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/login`,
  });
}

/** 账户删除通知邮件（阶段 2-3；尽力而为，失败不阻塞删除主流程） */
export async function sendAccountDeletedEmail(params: AccountDeletedEmailParams): Promise<void> {
  const sent = await sendViaResend({
    to: params.to,
    subject: "你的 corps 账户已删除",
    html: renderAccountDeletedHtml(params),
    logTag: "account_deleted",
  });
  if (!sent && !isEmailConfigured()) {
    logPlaceholder("account_deleted", `to=${params.to}, ws=${params.deletedWorkspaces}`);
  }
}
