/**
 * 邮件发送工具
 *
 * 开发模式（NODE_ENV !== "production" 或未配置 SMTP_HOST）：用 console.log 输出邮件内容，
 * 便于本地调试且不依赖外部服务。
 *
 * 生产模式（NODE_ENV === "production" 且配置了 SMTP_HOST）：暂用 console.log 占位，
 * 后续接入 Resend / SendGrid / AWS SES 等邮件 API（见下方 TODO）。
 */

export interface InviteEmailParams {
  to: string;
  workspaceName: string;
  inviterName: string;
}

/**
 * 发送工作区邀请邮件。
 *
 * 设计原则：邮件发送为"尽力而为"——调用方应 catch 异常并仅记录日志，
 * 不应因邮件发送失败而阻断业务流程（如邀请已创建成功）。
 *
 * TODO(prod): 接入真实邮件服务（Resend / SendGrid / AWS SES）。
 *   示例（Resend）：
 *   await fetch("https://api.resend.com/emails", {
 *     method: "POST",
 *     headers: {
 *       Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
 *       "Content-Type": "application/json",
 *     },
 *     body: JSON.stringify({
 *       from: process.env.MAIL_FROM ?? "noreply@corps.app",
 *       to,
 *       subject: `${inviterName} 邀请你加入 ${workspaceName}`,
 *       html: renderInviteHtml({ workspaceName, inviterName }),
 *     }),
 *   });
 */
export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  const { to, workspaceName, inviterName } = params;

  if (process.env.NODE_ENV === "production" && process.env.SMTP_HOST) {
    // 生产模式：暂用 console.log 占位，标记 TODO
    // TODO(prod): 替换为真实邮件 API 调用（见上方文档注释）
    console.log(
      `[email] invite sent to ${to} for workspace ${workspaceName} by ${inviterName}`,
    );
  } else {
    // 开发模式：输出完整内容便于调试
    console.log(
      `[email-dev] invite: to=${to}, workspace=${workspaceName}, inviter=${inviterName}`,
    );
  }
}