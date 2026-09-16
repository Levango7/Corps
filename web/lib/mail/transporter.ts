/**
 * 邮件发送库 — nodemailer transporter 工厂 + sendMail 封装
 *
 * 设计要点：
 *  - credential 以 AES-256-GCM 加密存储（与 offline-push.ts / 日历 OAuth token 同源）。
 *    解密后即为 SMTP 密码（或 OAuth token，当前仅支持密码认证）。
 *  - transporter 每次发送按需创建并即用即关，避免长连接持有 SMTP 服务端资源。
 *    高频场景可后续引入连接池，但需配合空闲超时回收。
 *  - sendMail 返回 nodemailer 原始 SendInfo（含 messageId/envelope/accepted 等），
 *    调用方据此落库 Mail 记录。
 *
 * 安全：
 *  - SMTP 密码仅在内存中解密，不落日志（console.error 仅打印 error.message）。
 *  - secure 标志按 EmailAccount.smtpSecure 传入（465 端口通常 true，587 通常 false + STARTTLS）。
 *  - P0-fix: credential 加解密统一走 @/lib/crypto 的 AES-256-GCM，
 *    与 offline-push.ts / 日历 OAuth token 保持一致（此前 Base64 与 AES-256 不一致）。
 *
 * 经验来源：2026-09-14-multi-database-field-type-layered-implementation-pattern
 *  - 纯函数库放在 lib/ 下，按领域子目录组织（lib/mail/）。
 */

import nodemailer, { type Transporter, type SendMailOptions, type SentMessageInfo } from "nodemailer";
import type { EmailAccount } from "@prisma/client";
import { encrypt, decrypt } from "@/lib/crypto";

/**
 * 解码 credential（AES-256-GCM 解密）为明文 SMTP 密码。
 *
 * P0-fix: 与 offline-push.ts 保持一致，统一使用 @/lib/crypto 的 decrypt。
 * 密钥来自环境变量 CALENDAR_CRYPTO_KEY（见 lib/crypto.ts）。
 *
 * @param credential AES-256-GCM 加密的密码（base64(iv || ciphertext || authTag)）
 * @returns 明文密码
 */
export function decodeCredential(credential: string): string {
  return decrypt(credential);
}

/**
 * 编码明文密码为 AES-256-GCM 密文用于存储。
 *
 * P0-fix: 与 decodeCredential 对称，使用 @/lib/crypto 的 encrypt。
 *
 * @param password 明文密码
 * @returns AES-256-GCM 加密字符串（base64(iv || ciphertext || authTag)）
 */
export function encodeCredential(password: string): string {
  return encrypt(password);
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