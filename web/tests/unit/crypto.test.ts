import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt, hash, verify } from "@/lib/crypto";

describe("crypto - AES-256-GCM 加密/解密", () => {
  beforeEach(() => {
    // 确保非生产环境，使用固定测试密钥
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("CALENDAR_CRYPTO_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("加密后解密应还原原文", () => {
    const plaintext = "hello world 你好世界";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("每次加密产生不同密文（IV 随机）", () => {
    const plaintext = "same text";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it("解密篡改的密文应抛错（认证失败）", () => {
    const encrypted = encrypt("secret");
    // 篡改最后一个字符
    const tampered = encrypted.slice(0, -2) + "XX";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("解密过短的密文应抛错", () => {
    expect(() => decrypt("short")).toThrow("密文长度不足");
  });

  it("支持 hex 编码的密钥", () => {
    vi.stubEnv(
      "CALENDAR_CRYPTO_KEY",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    const plaintext = "with hex key";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("支持 base64 编码的密钥", () => {
    // 32 字节 base64
    vi.stubEnv("CALENDAR_CRYPTO_KEY", Buffer.alloc(32, 7).toString("base64"));
    const plaintext = "with base64 key";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("无效长度的密钥应抛错", () => {
    vi.stubEnv("CALENDAR_CRYPTO_KEY", "shortkey");
    expect(() => encrypt("test")).toThrow();
  });

  it("生产环境未配置密钥应抛错", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CALENDAR_CRYPTO_KEY", "");
    expect(() => encrypt("test")).toThrow("生产环境必须配置");
  });
});

describe("crypto - scrypt 哈希/校验", () => {
  it("hash 返回非空字符串", async () => {
    const hashed = await hash("mypassword");
    expect(hashed).toBeTruthy();
    expect(typeof hashed).toBe("string");
    expect(hashed.length).toBeGreaterThan(0);
  });

  it("verify 正确密码返回 true", async () => {
    const hashed = await hash("mypassword");
    const result = await verify("mypassword", hashed);
    expect(result).toBe(true);
  });

  it("verify 错误密码返回 false", async () => {
    const hashed = await hash("mypassword");
    const result = await verify("wrongpassword", hashed);
    expect(result).toBe(false);
  });

  it("相同密码的两次 hash 产生不同哈希（salt 随机）", async () => {
    const a = await hash("same");
    const b = await hash("same");
    expect(a).not.toBe(b);
  });
});
