import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadEnv, getEnv } from "@/lib/env";

describe("env - 环境变量验证", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("测试环境跳过验证，直接返回 process.env", () => {
    vi.stubEnv("NODE_ENV", "test");
    const env = loadEnv();
    // 测试环境直接返回 process.env，不做 zod 校验
    expect(env).toBeDefined();
  });

  it("生产环境缺失必需变量时抛错", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("JWT_ACCESS_SECRET", "");
    vi.stubEnv("JWT_REFRESH_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(() => loadEnv()).toThrow("环境变量验证失败");
  });

  it("开发环境缺失必需变量时抛错", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("JWT_ACCESS_SECRET", "");
    vi.stubEnv("JWT_REFRESH_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(() => loadEnv()).toThrow("环境变量验证失败");
  });

  it("所有必需变量合法时不抛错", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(32));
    vi.stubEnv("JWT_REFRESH_SECRET", "b".repeat(32));
    vi.stubEnv("BETTER_AUTH_SECRET", "c".repeat(32));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    const env = loadEnv();
    expect(env.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/db");
  });

  it("JWT_ACCESS_SECRET 少于 32 字符时校验失败", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("JWT_ACCESS_SECRET", "short");
    vi.stubEnv("JWT_REFRESH_SECRET", "b".repeat(32));
    vi.stubEnv("BETTER_AUTH_SECRET", "c".repeat(32));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    expect(() => loadEnv()).toThrow();
  });

  it("DATABASE_URL 非 URL 格式时校验失败", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "not-a-url");
    vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(32));
    vi.stubEnv("JWT_REFRESH_SECRET", "b".repeat(32));
    vi.stubEnv("BETTER_AUTH_SECRET", "c".repeat(32));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    expect(() => loadEnv()).toThrow();
  });

  it("可选变量缺失时不报错", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(32));
    vi.stubEnv("JWT_REFRESH_SECRET", "b".repeat(32));
    vi.stubEnv("BETTER_AUTH_SECRET", "c".repeat(32));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("REDIS_URL", "");

    const env = loadEnv();
    expect(env).toBeDefined();
  });

  it("LOG_LEVEL 有默认值 info", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(32));
    vi.stubEnv("JWT_REFRESH_SECRET", "b".repeat(32));
    vi.stubEnv("BETTER_AUTH_SECRET", "c".repeat(32));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    const env = loadEnv();
    expect(env.LOG_LEVEL).toBe("info");
  });
});

describe("getEnv - 惰性单例", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("返回 Env 对象", () => {
    const env = getEnv();
    expect(env).toBeDefined();
  });
});
