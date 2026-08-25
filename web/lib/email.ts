/**
 * 邮件发送工具
 *
 * 发送优先级：
 * 1. RESEND_API_KEY 已配置 → 走 Resend HTTP API 真实发送（零新增依赖，fetch 实现）
 * 2. 未配置 → 维持占位行为：生产+SMTP_HOST 输出摘要日志，其余输出开发调试日志
 *
 * 设计原则：邮件为"尽力而为"——任何发送失败只记 console.error，绝不阻断业务流程。
 */

export interface InviteEmailParams {
  to: string;
  workspaceName: string;
  inviterName: string;
}

/** HTML 转义（workspaceName/inviterName 为用户可控输入，防邮件内容注入） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInviteHtml(params: InviteEmailParams): string {
  return (
    `<p>${escapeHtml(params.inviterName)} 邀请你加入 <strong>` +
    `${escapeHtml(params.workspaceName)}</strong>。</p>` +
    `<p>请登录后在目标工作区的成员页接受邀请。</p>`
  );
}

export async function sendInviteEmail(params: InviteEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  // 优先路径：Resend HTTP API（https://resend.com/docs），失败尽力而为
  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM ?? "noreply@corps.app",
          to: params.to,
          subject: `${params.inviterName} 邀请你加入 ${params.workspaceName}`,
          html: renderInviteHtml(params),
        }),
      });
      if (!res.ok) {
        throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      console.log(`[email] invite sent to ${params.to} for workspace ${params.workspaceName} by ${params.inviterName}`);
      return;
    } catch (err) {
      console.error("[email] invite send failed (non-blocking):", err);
      return;
    }
  }

  // 占位路径（兼容保留）：NODE_ENV 必须在函数内部动态读取，
  // 否则测试中通过 beforeEach 设置 process.env.NODE_ENV 将不生效。
  if (process.env.NODE_ENV === "production" && process.env.SMTP_HOST) {
    console.log(`[email] invite sent to ${params.to} for workspace ${params.workspaceName} by ${params.inviterName}`);
  } else {
    console.log(`[email-dev] invite: to=${params.to}, workspace=${params.workspaceName}, inviter=${params.inviterName}`);
  }
}
