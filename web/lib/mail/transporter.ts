/**
 * 邮件发送库 — nodemailer transporter 工厂 + sendMail 封装
 *
 * 设计要点：
 *  - credential 以 Base64 编码存储（简明方案；生产环境应改用 AES-256 加密）。
 *    解码后即为 SMTP 密码（或 OAuth token，当前仅支持密码认证）。
 *  - transporter 每次发送按需创建并即用即关，避免长连接持有 SMTP 服务端资源。
 *    高频场景可后续引入连接池，但需配合空闲超时回收。
 *  - sendMail 返回 nodemailer 原始 SendInfo（含 messageId/envelope/accepted 等），
 *    调用方据此落库 Mail 记录。
 *
 * 安全：
 *  - SMTP 密码仅在内存中解码，不落日志（console.error 仅打印 error.message）。
 *  - secure 标志按 EmailAccount.smtpSecure 传入（465 端口通常 true，587 通常 false + STARTTLS）。
 *
 * 经验来源：2026-09-14-multi-database-field-type-layered-implementation-pattern
 *  - 纯函数库放在 lib/ 下，按领域子目录组织（lib/mail/）。
 */

import nodemailer, { type Transporter, type SendMailOptions, type SentMessageInfo } from "nodemailer";
import type { EmailAccount } from "@prisma/client";

/**
 * 解码 credential（Base64）为明文 SMTP 密码。
 *
 * 约定：credential 字段存 Base64 编码的密码字符串。
 * 生产环境应替换为 AES-256 解密（密钥来自环境变量），此处保持简明。
 *
 * @param credential Base64 编码的密码
 * @returns 明文密码
 */
export function decodeCredential(credential: string): string {
  // Buffer.from 默认 UTF-8，Base64 解码后转 UTF-8 字符串
  return Buffer.from(credential, "base64").toString("utf-8");
}

/**
 * 编码明文密码为 Base64 用于存储。
 *
 * @param password 明文密码
 * @returns Base64 编码字符串
 */
export function encodeCredential(password: string): string {
  return Buffer.from(password, "utf-8").toString("base64");
}

/**
 * 根据 EmailAccount 配置创建 nodemailer transporter。
 *
 * - SMTP 主机/端口/secure 来自账户配置
 * - 认证：user = email，pass = decodeCredential(credential)
 * - 每次调用创建新实例；调用方负责在发送后 close（或使用 sendMail 封装自动关闭）
 *
 * @param account EmailAccount 记录（须含 smtpHost/smtpPort/smtpSecure/credential/email）
 * @returns nodemailer Transporter 实例
 */
export function createTransporter(account: EmailAccount): Transporter {
  const password = decodeCredential(account.credential);

  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: {
      user: account.email,
      pass: password,
    },
    // 连接超时 10s，避免 SMTP 不可达时长时间挂起
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

/**
 * 发送邮件并自动关闭 transporter。
 *
 * 封装 createTransporter → sendMail → close 的完整流程，
 * 保证每次发送后 SMTP 连接即时释放。
 *
 * @param account EmailAccount 记录
 * @param opts nodemailer SendMailOptions（to/cc/bcc/subject/text/html 等）
 * @returns nodemailer SendInfo（含 messageId/envelope/accepted/rejected）
 *
 * @throws Error 当 SMTP 连接或发送失败时抛出（调用方应捕获并返回 503）
 */
export async function sendMail(
  account: EmailAccount,
  opts: SendMailOptions,
): Promise<SentMessageInfo> {
  const transporter = createTransporter(account);
  try {
    const info = await transporter.sendMail(opts);
    return info;
  } finally {
    // 即用即关：无论成功或失败都关闭连接
    transporter.close();
  }
}