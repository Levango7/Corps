// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * db-pool 单元测试 —— 锁定 DATABASE_URL 连接池参数的解析与补齐行为。
 *
 * 背景（DL-3 缺陷修复）：lib/prisma.ts 原来只在注释里声称"通过 DATABASE_URL 的
 * query 参数配置 connection_limit / pool_timeout"，但仓库里两处 DATABASE_URL
 * 都只有 ?schema=public，两个参数从未落地，实际生效的一直是 Prisma 默认值
 * （connection_limit = 容器可见 CPU 核数 × 2 + 1，随宿主机漂移）。
 *
 * Mock 策略（**无 mock**）：本测试只 import lib/db-pool.ts——它刻意不依赖
 * @prisma/client。原因：CI 的 Unit Coverage Ratchet job 是全仓库唯一不设
 * DATABASE_URL 的 job，且本地未必存在客户端生成产物（node_modules/.prisma），
 * 任何 import lib/prisma.ts 的单测都会挂在模块加载期而不是断言期。
 */

import {
  DB_POOL_DEFAULTS,
  DatabaseUrlMissingError,
  readPoolConfig,
  resolveDatabaseUrl,
  withPoolParams,
} from "@/lib/db-pool";

const BASE_URL = "postgresql://corps:secret@db:5432/corps";

/** 取出 URL 的 query 参数，避免用字符串包含判断（那会被子串误命中骗过） */
function queryOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

/**
 * 构造 NodeJS.ProcessEnv 字面量。
 *
 * 为什么不能裸传 `{}`：Next 在 node_modules/next/types/global.d.ts:21 给
 * ProcessEnv 增强了**必填且只读**的 `NODE_ENV: 'development' | 'production' | 'test'`，
 * 于是 `{ DATABASE_URL: "..." }` 对 ProcessEnv 缺属性，`tsc --noEmit` 直接红。
 * 这是 Next 的真实约束而非类型噪音，所以签名为 NodeJS.ProcessEnv 保持不变，
 * 由测试侧统一补齐 NODE_ENV（生产侧传的就是 process.env，天然满足）。
 */
function envOf(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...extra, NODE_ENV: "test" };
}

describe("withPoolParams —— 补齐缺失的连接池参数", () => {
  it("无 query 的 URL：connection_limit 与 pool_timeout 都被追加（断言 1）", () => {
    const out = withPoolParams(BASE_URL);
    expect(queryOf(out).get("connection_limit")).toBe("10");
    expect(queryOf(out).get("pool_timeout")).toBe("5");
  });

  it("已有 ?schema=public：保留 schema，且分隔符正确——不出现 ?? 或两个 ?（断言 2）", () => {
    const out = withPoolParams(`${BASE_URL}?schema=public`);
    expect(queryOf(out).get("schema")).toBe("public");
    expect(queryOf(out).get("connection_limit")).toBe("10");
    expect(queryOf(out).get("pool_timeout")).toBe("5");
    // 分隔符合法性：整个 URL 里只能有一个 '?'，且不能出现 '??'
    expect(out.split("?").length).toBe(2);
    expect(out).not.toContain("??");
    // base 段（含凭据与端口）必须原样保留，不能被重新编码
    expect(out.startsWith(`${BASE_URL}?`)).toBe(true);
  });

  it("URL 已显式写 connection_limit=42：保留 42，不被默认值覆盖（断言 3，运维优先护栏）", () => {
    const out = withPoolParams(`${BASE_URL}?schema=public&connection_limit=42`);
    expect(queryOf(out).get("connection_limit")).toBe("42");
    // 只补缺失的那个：pool_timeout 仍然要补上
    expect(queryOf(out).get("pool_timeout")).toBe("5");
    expect(queryOf(out).get("schema")).toBe("public");
  });

  it("URL 已显式写 pool_timeout=30：保留 30，只补 connection_limit", () => {
    const out = withPoolParams(`${BASE_URL}?pool_timeout=30`);
    expect(queryOf(out).get("pool_timeout")).toBe("30");
    expect(queryOf(out).get("connection_limit")).toBe("10");
  });

  it("自定义 cfg：只在参数缺失时生效", () => {
    const cfg = { connectionLimit: 25, poolTimeoutSeconds: 15 };
    expect(queryOf(withPoolParams(BASE_URL, cfg)).get("connection_limit")).toBe("25");
    expect(queryOf(withPoolParams(BASE_URL, cfg)).get("pool_timeout")).toBe("15");
    // 已显式配置时 cfg 不生效
    expect(
      queryOf(withPoolParams(`${BASE_URL}?connection_limit=42`, cfg)).get("connection_limit"),
    ).toBe("42");
  });
});

describe("readPoolConfig —— 非法值回退、越界值夹取（断言 4）", () => {
  it("空 env：返回默认值 10 / 5", () => {
    expect(readPoolConfig(envOf())).toEqual({ connectionLimit: 10, poolTimeoutSeconds: 5 });
    expect(DB_POOL_DEFAULTS).toEqual({ connectionLimit: 10, poolTimeoutSeconds: 5 });
  });

  it("合法值：原样采用", () => {
    expect(
      readPoolConfig(envOf({ CORPS_DB_CONNECTION_LIMIT: "20", CORPS_DB_POOL_TIMEOUT_S: "30" })),
    ).toEqual({ connectionLimit: 20, poolTimeoutSeconds: 30 });
  });

  it("空串 / 非数字 / ≤0：回退默认值而不是抛错", () => {
    for (const raw of ["", "   ", "abc", "0", "-1", "1.5", "NaN"]) {
      expect(readPoolConfig(envOf({ CORPS_DB_CONNECTION_LIMIT: raw })).connectionLimit).toBe(10);
      expect(readPoolConfig(envOf({ CORPS_DB_POOL_TIMEOUT_S: raw })).poolTimeoutSeconds).toBe(5);
    }
  });

  it("超过上界：夹到上界（connection_limit 100、pool_timeout 60）", () => {
    expect(readPoolConfig(envOf({ CORPS_DB_CONNECTION_LIMIT: "1e9" })).connectionLimit).toBe(100);
    expect(readPoolConfig(envOf({ CORPS_DB_CONNECTION_LIMIT: "101" })).connectionLimit).toBe(100);
    expect(readPoolConfig(envOf({ CORPS_DB_POOL_TIMEOUT_S: "1e9" })).poolTimeoutSeconds).toBe(60);
    expect(readPoolConfig(envOf({ CORPS_DB_POOL_TIMEOUT_S: "3600" })).poolTimeoutSeconds).toBe(60);
  });

  it("前后空白与整数写法：容忍常见书写差异", () => {
    expect(readPoolConfig(envOf({ CORPS_DB_CONNECTION_LIMIT: " 12 " })).connectionLimit).toBe(12);
    expect(readPoolConfig(envOf({ CORPS_DB_POOL_TIMEOUT_S: "1e1" })).poolTimeoutSeconds).toBe(10);
  });
});

describe("resolveDatabaseUrl —— 缺失即抛、命中即补齐（断言 5）", () => {
  it("DATABASE_URL 缺失或为空：抛 DatabaseUrlMissingError，不静默返回空串", () => {
    expect(() => resolveDatabaseUrl(envOf())).toThrow(DatabaseUrlMissingError);
    expect(() => resolveDatabaseUrl(envOf({ DATABASE_URL: "" }))).toThrow(DatabaseUrlMissingError);
    expect(() => resolveDatabaseUrl(envOf({ DATABASE_URL: "   " }))).toThrow(
      DatabaseUrlMissingError,
    );
  });

  it("缺失时抛出的错误带可读 message，便于值班定位", () => {
    expect(() => resolveDatabaseUrl(envOf())).toThrow(/DATABASE_URL/);
    try {
      resolveDatabaseUrl(envOf());
      expect.unreachable("resolveDatabaseUrl 应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseUrlMissingError);
      expect((error as Error).name).toBe("DatabaseUrlMissingError");
    }
  });

  it("正常情况：补齐连接池参数，且保留原有 schema", () => {
    const out = resolveDatabaseUrl(envOf({ DATABASE_URL: `${BASE_URL}?schema=public` }));
    expect(queryOf(out).get("schema")).toBe("public");
    expect(queryOf(out).get("connection_limit")).toBe("10");
    expect(queryOf(out).get("pool_timeout")).toBe("5");
  });

  it("环境变量覆盖生效：CORPS_DB_CONNECTION_LIMIT 参与最终 URL", () => {
    const out = resolveDatabaseUrl(
      envOf({
        DATABASE_URL: BASE_URL,
        CORPS_DB_CONNECTION_LIMIT: "30",
        CORPS_DB_POOL_TIMEOUT_S: "20",
      }),
    );
    expect(queryOf(out).get("connection_limit")).toBe("30");
    expect(queryOf(out).get("pool_timeout")).toBe("20");
  });
});
