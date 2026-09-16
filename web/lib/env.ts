import { z } from "zod";

/**
 * 环境变量验证 schema
 * 启动时校验所有必需的环境变量，缺失时 fail-fast 并列出缺失项
 */

const envSchema = z.object({
  // 数据库
  DATABASE_URL: z.string().url().describe("PostgreSQL 连接字符串"),

  // JWT 密钥
  JWT_ACCESS_SECRET: z.string().min(32).describe("JWT access token 签名密钥（≥32 字符）"),
  JWT_REFRESH_SECRET: z.string().min(32).describe("JWT refresh token 签名密钥（≥32 字符）"),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32).describe("Better Auth 密钥（≥32 字符）"),

  // 应用 URL
  NEXT_PUBLIC_APP_URL: z.string().url().describe("应用公开 URL"),

  // 可选变量
  DEEPSEEK_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  REDIS_URL: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "fatal"]).optional().default("info"),
  RATE_LIMIT_DISABLED: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 解析并验证环境变量
 * 在开发环境下缺失必需变量时抛出详细错误信息
 * 在测试环境下跳过验证（返回 process.env as Env）
 */
export function loadEnv(): Env {
  // 测试环境跳过验证
  if (process.env.NODE_ENV === "test") {
    return process.env as unknown as Env;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `环境变量验证失败，请检查 .env 文件：\n${missing}\n\n必需变量：DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL`,
    );
  }

  return result.data;
}

// 惰性单例：首次调用 loadEnv() 时解析，后续复用
let _env: Env | null = null;
export function getEnv(): Env {
  if (!_env) _env = loadEnv();
  return _env;
}