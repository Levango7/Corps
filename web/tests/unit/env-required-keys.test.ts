// @vitest-environment node
/**
 * 必填环境变量的部署侧覆盖（补 compose-env-coverage.test.ts 的 zod 声明盲区）
 *
 * 起源（2026-10-03 实测）：`docker compose up -d` 在一个干净环境里**启动即失败**——
 * 容器日志停在 `[instrumentation] 环境变量验证失败: JWT_REFRESH_SECRET: String must
 * contain at least 32 character(s)` 然后 Exit 1。原因链：
 *   1. `lib/env.ts` 用 zod 把 JWT_REFRESH_SECRET 声明为**必填**（missing 即 process.exit(1)）；
 *   2. 它既没写进 docker-compose.yml 的 app environment，也没写进 .env.example；
 *   3. `compose-env-coverage.test.ts` 没抓到——那份只扫 `process.env.X` / `envFlag("X")`
 *      两种写法，而 zod schema 里的声明形式是 **`KEY: z.string()`**，压根不在扫描口径内。
 *
 * 于是本测试补这个口径：从 lib/env.ts 的 zod 源码里取出**必填键**（区分 optional），
 * 断言它们同时出现在 compose app environment 与 .env.example。
 * 同类缺口历史上已经出现三次（支付类 → CRON_SECRET → 日历类），这次是第四次，
 * 差别只在于前三次都写在 `process.env.X` 形式里目。
 *
 * 关键约束：这道门守的是"能不能起来"，因此任何"为了变绿而放宽口径"的改动
 * 都必须连同理由写进本文件头。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const envSrc = readFileSync(join(HERE, "..", "..", "lib", "env.ts"), "utf-8");
const composeSrc = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf-8");
const exampleSrc = readFileSync(join(REPO_ROOT, ".env.example"), "utf-8");

/** 取 zod schema 里形如 `KEY: z.xxx` 的声明，区分 required / optional */
function collectSchemaKeys(src: string): { required: string[]; optional: string[] } {
  const required: string[] = [];
  const optional: string[] = [];
  const re = /^\s{2}([A-Z][A-Z0-9_]*)\s*:\s*(.+?),\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const key = m[1];
    const expr = m[2];
    if (/\boptional\b|\bdefault\(/.test(expr)) {
      optional.push(key);
    } else {
      required.push(key);
    }
  }
  return { required, optional };
}

describe("zod 声明的必填 env 必须在部署侧到位", () => {
  const { required, optional } = collectSchemaKeys(envSrc);

  it("至少解析出 lib/env.ts 已文档化的五个必填键（防 parser 静默失效）", () => {
    expect(required.length).toBeGreaterThan(0);
    for (const key of [
      "DATABASE_URL",
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "BETTER_AUTH_SECRET",
      "NEXT_PUBLIC_APP_URL",
    ]) {
      expect(required, `必填键 ${key} 应被解析出来`).toContain(key);
    }
  });

  it("optional() 的键不得落入必填集合（防误把可选项判成必需）", () => {
    expect(required).not.toContain("DEEPSEEK_API_KEY");
    expect(required).not.toContain("REDIS_URL");
    expect(optional).toContain("REDIS_URL");
  });

  it("每个必填键都被 compose app environment 透传", () => {
    // 只取 app 服务那一段，避免命中 db/redis 服务的同名字段
    const appBlock = composeSrc.slice(composeSrc.indexOf("  app:"));
    const missing = required.filter((k) => !new RegExp(`^\\s{6}${k}:`, "m").test(appBlock));
    expect(
      missing,
      `以下必填 env 未在 docker-compose.yml 的 app.environment 透传（按文档部署会启动失败）:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("每个必填键都在 .env.example 里有条目（用户照抄才会不踩坑）", () => {
    const missing = required.filter((k) => !new RegExp(`^${k}=`, "m").test(exampleSrc));
    expect(missing, `以下必填 env 未在 .env.example 声明:\n${missing.join("\n")}`).toEqual([]);
  });
});
