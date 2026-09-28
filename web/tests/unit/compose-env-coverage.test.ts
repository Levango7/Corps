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
 *  - K8S_REPLICAS / PM2_INSTANCES：部署编排变量，由 K8s/PM2 编排层注入，
 *    非应用运行时配置（lib/chat-events.ts 多实例检测用）
 *  - DEEPSEEK_API_KEY：DeepSeek AI 服务密钥，可选功能，未配置时降级为空字符串
 *  - LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL：LiveKit 音视频服务，
 *    可选功能，未配置时 meetings join 路由返回 501
 *  - RECYCLE_RETENTION_DAYS：回收站保留天数，有缺省值 30 天
 *  - WECHAT_PLATFORM_PUBLIC_KEY_PEM / WECHAT_PRIVATE_KEY_PEM：微信支付平台
 *    密钥对，可选支付渠道，未配置时走 Stripe
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/** 豁免清单：代码会引用、但不要求 compose 透传（理由见文件头） */
const EXEMPT = new Set([
  "NODE_ENV",
  "RATE_LIMIT_DISABLED",
  "MAIL_FROM",
  "SMTP_HOST",
  // 部署编排变量（K8s/PM2 编排层注入，非应用运行时配置）
  "K8S_REPLICAS",
  "PM2_INSTANCES",
  // 可选功能密钥/配置（未配置时有合理降级）
  "DEEPSEEK_API_KEY",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_URL",
  "RECYCLE_RETENTION_DAYS",
  "WECHAT_PLATFORM_PUBLIC_KEY_PEM",
  "WECHAT_PRIVATE_KEY_PEM",
  // 推送通知密钥（各平台可选，未配置时降级为无推送）
  "APNS_KEY_ID",
  "APNS_PRIVATE_KEY",
  "APNS_TEAM_ID",
  "FIREBASE_SERVER_KEY",
  "HUAWEI_APP_ID",
  "HUAWEI_APP_SECRET",
  "PUSH_ADMIN_USER_IDS",
  // AI/OpenAI 可选功能密钥（未配置时降级为空字符串）
  "OPENAI_API_KEY",
  // LiveKit 音视频服务配置（未配置时 meetings 路由返回 501）
  "LIVEKIT_TOKEN_TTL",
  // 附件域名白名单（可选，未配置时使用默认值）
  "ALLOWED_ATTACHMENT_DOMAINS",
  // APNS Bundle ID（Apple 推送可选功能）
  "APNS_BUNDLE_ID",
]);

/**
 * 遍历目录收集 .ts/.tsx 文件。
 *
 * 用 withFileTypes 直接拿目录项类型，省掉每个条目的 statSync——这是本测试的主要开销：
 * 全树 496 个文件 + 约 1000 次 stat，在 CI/本地并行 worker 满载时会把默认 15s 超时打穿
 * （实测：独占 1.1s，满载 >15s 超时）。语义与逐个 stat 完全一致。
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 代码内 process.env 引用集合（进程内缓存）。
 *
 * 两个用例都需要这份数据；不缓存就要把 496 个文件读两遍。目录树在单个测试进程生命周期
 * 内不会变化（vitest 每个文件一个进程），缓存安全且把 IO 减半。
 */
let cachedEnvRefs: Set<string> | null = null;

function collectCodeEnvRefs(): Set<string> {
  if (cachedEnvRefs) return cachedEnvRefs;
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
  cachedEnvRefs = envs;
  return envs;
}

/**
 * 全树同步扫描的显式超时预算。默认 15s 是给普通单测的；本测试的耗时随仓库文件数线性增长，
 * 且与并行 worker 争抢磁盘 CPU——CI 上偶发超时并不代表逻辑回归。逻辑本身仍是全量断言，
 * 这里只放宽"等机器"的时间。
 */
const SCAN_TIMEOUT_MS = 60_000;

function collectComposeEnvKeys(): Set<string> {
  const dc = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");
  // app 服务 environment 块下的键（6 空格缩进大写；{6} 显式计数避免硬数字格）
  return new Set([...dc.matchAll(/^ {6}([A-Z_][A-Z0-9_]*):/gm)].map((m) => m[1]));
}

describe("compose env 全量覆盖（代码 process.env 引用 ⊆ compose 透传）", () => {
  it(
    "代码引用的每个服务端 env 都被 compose app environment 透传（豁免除外）",
    () => {
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
    },
    SCAN_TIMEOUT_MS,
  );

  it(
    "豁免清单本身仍被代码真实引用（防豁免腐烂成死条目）",
    () => {
      const codeEnvs = collectCodeEnvRefs();
      for (const v of EXEMPT) {
        expect(codeEnvs.has(v), `豁免 ${v} 已无代码引用，应从 EXEMPT 移除`).toBe(true);
      }
    },
    SCAN_TIMEOUT_MS,
  );
});
