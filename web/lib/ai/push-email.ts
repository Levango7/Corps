// AI 推送邮件渠道
//
// 用现有 RESEND_API_KEY 环境变量发送 AI 推送摘要邮件。
// 参照 web/lib/ai/push-runner.ts 的 PROMPT_BUILDERS 模式与 web/lib/email.ts
// 的 Resend HTTP API 调用模式，独立实现邮件推送渠道：
//   - 检查 RESEND_API_KEY 是否存在，不存在直接返回 { success: false, error }
//   - 用 fetch 调用 Resend API（POST https://api.resend.com/emails）
//   - 用 logger（@/lib/logger）记录发送结果，统一结构化日志
//   - 30s 超时防护（AbortController），避免长尾请求阻塞 cron
//
// 设计要点：
//   - 与 web/lib/email.ts 的 sendViaResend 保持一致的 from 解析逻辑
//     （EMAIL_FROM 优先，MAIL_FROM 兼容，缺省 noreply@corps.app）
//   - 失败不抛异常，返回 { success: false, error } 由调用方决策
//   - 不做 HTML 转义（调用方负责传入已转义的 html）

import { logger } from "@/lib/logger";

/** sendPushEmail 选项 */
export interface SendPushEmailOpts {
  /** 收件人邮箱 */
  to: string;
  /** 邮件主题 */
  subject: string;
  /** 邮件 HTML 内容（调用方负责转义用户可控输入） */
  html: string;
  /** 工作区 ID（用于日志关联，不参与邮件发送） */
  workspaceId: string;
}

/** sendPushEmail 返回值 */
export interface SendPushEmailResult {
  success: boolean;
  error?: string;
}

/** Resend API 端点 */
const RESEND_API_URL = "https://api.resend.com/emails";
/** HTTP 调用超时（30s，与 web/lib/email.ts 的 sendViaResend 一致） */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 通过 Resend HTTP API 发送 AI 推送摘要邮件。
 *
 * 检查 RESEND_API_KEY 是否存在，不存在则返回
 * { success: false, error: 'RESEND_API_KEY not configured' }。
 *
 * 发送结果用 logger 记录（info 成功 / warn 失败），不抛异常。
 *
 * @returns { success: boolean, error?: string }
 */
export async function sendPushEmail(
  opts: SendPushEmailOpts,
): Promise<SendPushEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("[ai/push-email] RESEND_API_KEY not configured", {
      workspaceId: opts.workspaceId,
      to: opts.to,
    });
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  // from 解析与 web/lib/email.ts 的 sendViaResend 一致：
  // EMAIL_FROM 优先，MAIL_FROM 历史兼容，缺省 noreply@corps.app
  const from =
    process.env.EMAIL_FROM ?? process.env.MAIL_FROM ?? "noreply@corps.app";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(RESEND_API_URL, {
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
      const errBody = await res.text().catch(() => "");
      const error = `Resend HTTP ${res.status}: ${errBody.slice(0, 300)}`;
      logger.warn("[ai/push-email] 发送失败", {
        workspaceId: opts.workspaceId,
        to: opts.to,
        subject: opts.subject,
        error,
      });
      return { success: false, error };
    }

    logger.info("[ai/push-email] 发送成功", {
      workspaceId: opts.workspaceId,
      to: opts.to,
      subject: opts.subject,
    });
    return { success: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.warn("[ai/push-email] 发送异常", {
      workspaceId: opts.workspaceId,
      to: opts.to,
      subject: opts.subject,
      error,
    });
    return { success: false, error };
  } finally {
    // 确保超时 timer 在任何情况下都被清理，防止 timer handle 泄漏
    clearTimeout(timeoutId);
  }
}

/**
 * 构建 AI 推送摘要邮件 HTML。
 *
 * 与 web/lib/email.ts 的 renderEmailHtml 风格一致（简洁、无外部 CSS 依赖），
 * 但独立实现以避免引入对私有函数的依赖。调用方负责对 title/summary 做转义，
 * 本函数对传入的 title/summary/workspaceUrl 做 HTML 转义防护。
 */
export function renderPushEmailHtml(opts: {
  title: string;
  summary: string;
  workspaceUrl: string;
}): string {
  const safeTitle = escapeHtml(opts.title);
  const safeSummary = escapeHtml(opts.summary);
  const safeUrl = escapeHtml(opts.workspaceUrl);
  // summary 可能含换行，转为 <br> 保留段落感
  const summaryHtml = safeSummary.replace(/\n/g, "<br>");

  return (
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${safeTitle}</title></head>` +
    `<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">` +
    `<tr><td style="padding:24px 32px 8px;"><h1 style="margin:0;font-size:18px;font-weight:600;line-height:1.4;color:#0f172a;">${safeTitle}</h1></td></tr>` +
    `<tr><td style="padding:8px 32px 24px;font-size:14px;line-height:1.6;color:#334155;">${summaryHtml}</td></tr>` +
    `<tr><td style="padding:0 32px 32px;">` +
    `<a href="${safeUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500;">查看详情</a>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;">corps · AI 推送通知</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

/** HTML 转义（与 web/lib/email.ts 的 escapeHtml 一致，防邮件内容注入） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}