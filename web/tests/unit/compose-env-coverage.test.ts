// @vitest-environment node
/**
 * compose env 全量覆盖检查（审计第二阶段 2-1b 防复发）
 *
 * 背景：.env.example / compose 的环境变量缺口已出现三次（支付类 →
 * CRON_SECRET → 日历类，详见审计 P1-B）——新增服务端 env 时漏传 compose
 * 导致按文档部署后功能静默不可用。本测试从**代码事实**出发：扫描
 * web/lib + web/app 的全部 process.env.X 引用，断言每个都被 compose
 * app environment 透传（豁免清单除外）。
 *
 * 豁免（代码引用但非 compose 部署所需，逐条理由）：
 *  - NODE_ENV：Dockerfile 内已设 production，运行环境固有
 *  - RATE_LIMIT_DISABLED：测试/本地专用限流开关，生产必须开启限流
 *  - MAIL_FROM / SMTP_HOST：email.ts 历史兼容回退与占位日志分支，
 *    生产变量为 EMAIL_FROM / RESEND_API_KEY（已断言）
 *  - NODE_OPTIONS 等运行时注入变量同理不入清单
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** 豁免清单：代码会引用、但不要求 compose 透传（理由见文件头） */
const EXEMPT = new Set(["NODE_ENV", "RATE_LIMIT_DISABLED", "MAIL_FROM", "SMTP_HOST"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

function collectCodeEnvRefs(): Set<string> {
  const dirs = [join(REPO_ROOT, "web/lib"), join(REPO_ROOT, "web/app")];
  const envs = new Set<string>();
  for (const dir of dirs) {
    for (const f of walk(dir)) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
        envs.add(m[1]);
      }
    }
  }
  return envs;
}

function collectComposeEnvKeys(): Set<string> {
  const dc = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");
  // app 服务 environment 块下的键（6 空格缩进大写；{6} 显式计数避免硬数字格）
  return new Set([...dc.matchAll(/^ {6}([A-Z_][A-Z0-9_]*):/gm)].map((m) => m[1]));
}

describe("compose env 全量覆盖（代码 process.env 引用 ⊆ compose 透传）", () => {
  it("代码引用的每个服务端 env 都被 compose app environment 透传（豁免除外）", () => {
    const codeEnvs = collectCodeEnvRefs();
    const composeKeys = collectComposeEnvKeys();
    const missing = [...codeEnvs]
      .filter((v) => !EXEMPT.has(v))
      .filter((v) => !composeKeys.has(v))
      .sort();
    expect(
      missing,
      `代码引用但 compose 未透传（新增服务端 env 时必须同步 compose app ` +
        `environment 与 .env.example，豁免需在 EXEMPT 注明理由）:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("豁免清单本身仍被代码真实引用（防豁免腐烂成死条目）", () => {
    const codeEnvs = collectCodeEnvRefs();
    for (const v of EXEMPT) {
      expect(codeEnvs.has(v), `豁免 ${v} 已无代码引用，应从 EXEMPT 移除`).toBe(true);
    }
  });
});
