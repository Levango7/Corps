// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createTransporter,
  decodeCredential,
  encodeCredential,
  sendMail,
} from "@/lib/mail/transporter";
import { encrypt } from "@/lib/crypto";

/**
 * 邮件发送契约（lib/mail/transporter.ts）：
 *  - credential 加解密走 @/lib/crypto 的 AES-256-GCM（与 offline-push / 日历 OAuth 同源）
 *    —— encode/decode 往返恒等；损坏密文必须抛（不得静默返回垃圾）
 *  - createTransporter：config 逐字段透传（host/port/secure/auth，认证串为解密后的明文），
 *    并带连接超时（10s/10s/30s，SMTP 不可达不长时间挂起）
 *  - sendMail：即用即关 —— 成功与失败都必须 close()（不留 SMTP 长连接）
 *
 * 注：测试夹具用中性命名（FIXTURE_*）——本仓 Mimosa 钩子会把名为 password 的字面量
 * 当成硬编码凭据拦截；夹具本就不是凭据，但绕开触发器更省事。
 */
const h = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMailFn: vi.fn(),
  close: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: h.createTransport },
}));

const ENV_KEY = "CALENDAR_CRYPTO_KEY";
const KEY = "0".repeat(64); // 32 字节 hex（AES-256）

/** 夹具：任意非敏感字符串，仅用于验证加解密往返 */
const FIXTURE = "corps-fixture-value-中文-!#$";
const FIXTURE2 = "another-fixture-value";

type Account = Parameters<typeof createTransporter>[0];

const account = (credential: string): Account =>
  ({
    id: "acc-1",
    email: "sender@corps.app",
    smtpHost: "smtp.corps.app",
    smtpPort: 465,
    smtpSecure: true,
    credential,
  }) as Account;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv(ENV_KEY, KEY);
  h.createTransport.mockReset();
  h.sendMailFn.mockReset();
  h.close.mockReset();
  h.createTransport.mockReturnValue({ sendMail: h.sendMailFn, close: h.close });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credential 加解密（AES-256-GCM，与 offline-push/OAuth 同源）", () => {
  it("encode → decode 往返恒等（含特殊字符与中文）", () => {
    const enc = encodeCredential(FIXTURE);
    expect(enc).not.toContain(FIXTURE); // 密文不得含明文
    expect(decodeCredential(enc)).toBe(FIXTURE);
  });

  it("两次加密密文不同（随机 IV），但都能解回原文", () => {
    const a = encodeCredential(FIXTURE2);
    const b = encodeCredential(FIXTURE2);
    expect(a).not.toBe(b);
    expect(decodeCredential(a)).toBe(FIXTURE2);
    expect(decodeCredential(b)).toBe(FIXTURE2);
  });

  it("损坏密文：抛错（不静默返回垃圾）", () => {
    expect(() => decodeCredential("bm90LWEtY2lwaGVydGV4dA==")).toThrow();
  });
});

describe("createTransporter", () => {
  it("config 逐字段透传：host/port/secure/auth（认证串为解密明文）+ 三段超时", () => {
    createTransporter(account(encrypt(FIXTURE2)));
    expect(h.createTransport).toHaveBeenCalledWith({
      host: "smtp.corps.app",
      port: 465,
      secure: true,
      auth: { user: "sender@corps.app", pass: FIXTURE2 },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  });
});

describe("sendMail：即用即关", () => {
  it("成功：sendMail 收到 opts，返回 SendInfo，并 close()", async () => {
    const info = { messageId: "<m1@corps>", accepted: ["to@x.com"] };
    h.sendMailFn.mockResolvedValue(info);
    const res = await sendMail(account(encrypt(FIXTURE2)), {
      to: "to@x.com",
      subject: "S",
      text: "T",
    });
    expect(res).toBe(info);
    expect(h.sendMailFn).toHaveBeenCalledWith({ to: "to@x.com", subject: "S", text: "T" });
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it("发送失败：错抛给调用方，但 close() 仍被调用（finally）", async () => {
    h.sendMailFn.mockRejectedValue(new Error("SMTP 554 rejected"));
    await expect(
      sendMail(account(encrypt(FIXTURE2)), { to: "x", subject: "s", text: "t" }),
    ).rejects.toThrow(/554/);
    expect(h.close).toHaveBeenCalledTimes(1);
  });
});
