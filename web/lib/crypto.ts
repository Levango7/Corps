import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * AES-256-GCM 对称加密工具：用于日历 OAuth token 加密存储。
 *
 * 设计：
 *  - 算法：AES-256-GCM（带认证的对称加密，防篡改）
 *  - 密钥：32 字节，来自环境变量 CALENDAR_CRYPTO_KEY（hex 或 base64）
 *  - IV：12 字节随机，每次加密独立生成，与密文一起存储
 *  - authTag：16 字节，附在密文末尾，解密时校验
 *  - 存储格式：base64(iv || ciphertext || authTag)
 *
 * 安全提示：CALENDAR_CRYPTO_KEY 必须为 32 字节强随机值，
 * 生成命令：openssl rand -hex 32
 */

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** 缺省密钥环境变量名 */
const ENV_CRYPTO_KEY = "CALENDAR_CRYPTO_KEY";

/**
 * 解析主密钥：优先用环境变量 CALENDAR_CRYPTO_KEY，
 * 开发环境未配置时退化为固定测试密钥（仅 dev/test 可用，生产必须配置）。
 */
function getMasterKey(): Buffer {
  const raw = process.env[ENV_CRYPTO_KEY];
  if (raw) {
    // 支持 hex（64 字符）或 base64（44 字符）两种编码
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
    const buf = Buffer.from(raw, "base64");
    if (buf.length === KEY_LENGTH) return buf;
    throw new Error(`CALENDAR_CRYPTO_KEY 长度无效（期望 ${KEY_LENGTH} 字节，实际 ${buf.length}）`);
  }
  // 开发环境回退：用确定性测试密钥（绝不用于生产）
  if (process.env.NODE_ENV === "production") {
    throw new Error(`生产环境必须配置 ${ENV_CRYPTO_KEY}（openssl rand -hex 32）`);
  }
  return Buffer.alloc(KEY_LENGTH, 7); // dev/test 固定密钥
}

/**
 * 加密明文字符串，返回 base64(iv || ciphertext || authTag)。
 * 失败时抛错（调用方负责处理，不应静默吞掉加密失败）。
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, authTag]).toString("base64");
}

/**
 * 解密 encrypt() 产出的密文，返回明文字符串。
 * 认证失败（密文被篡改 / 密钥不匹配）时抛错。
 */
export function decrypt(payload: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("密文长度不足");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const enc = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}