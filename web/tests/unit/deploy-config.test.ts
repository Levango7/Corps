/**
 * 部署清单配置校验（TC-RATE-05）
 *
 * 断言 docker-compose.yml 与 .env.example 包含 Redis 共享限流配置：
 *  - compose：redis 服务（redis:8-alpine + redis-cli ping 健康检查）、
 *    app 依赖 redis（service_healthy）、app 注入 REDIS_URL
 *  - .env.example：REDIS_URL 条目及单实例/多实例使用说明
 *
 * 说明：不引入 YAML 解析依赖，做面向关键配置行的文本断言（配置校验层级测试）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 测试位于 web/tests/unit/，回退三层到仓库根（F:\Nexus\corps）
// 注意：web/ 下也存在 docker-compose.yml，必须锚定仓库根以免误读
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const composeYml = readFileSync(resolve(REPO_ROOT, "docker-compose.yml"), "utf8");
const envExample = readFileSync(resolve(REPO_ROOT, ".env.example"), "utf8");

/** 截取 compose 中指定服务块（从 "  name:" 到下一个同级服务/顶层键之前） */
function serviceBlock(name: string): string {
  const lines = composeYml.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^\\s{2}${name}:\\s*$`).test(l));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    // 下一个同级服务（2 空格缩进键）或顶层键（volumes/networks 等）
    if (/^\s{2}[a-z][\w-]*:\s*$/.test(lines[i]) || /^[a-z][\w-]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

describe("docker-compose.yml Redis 配置（TC-RATE-05）", () => {
  it("存在 redis 服务且使用 redis:8-alpine 镜像 + redis-cli ping 健康检查", () => {
    const redis = serviceBlock("redis");
    expect(redis, "未找到 redis 服务块").not.toBe("");
    expect(redis).toMatch(/image:\s*redis:8-alpine/);
    expect(redis).toMatch(/redis-cli/);
    expect(redis).toMatch(/ping/);
    expect(redis).toMatch(/healthcheck:/);
  });

  it("app 服务注入 REDIS_URL 且 depends_on redis 为 service_healthy", () => {
    const app = serviceBlock("app");
    expect(app).toMatch(/REDIS_URL:\s*.*redis:\/\/redis:6379/);
    // depends_on 段内 redis 以健康为条件
    const dependsIdx = app.indexOf("depends_on:");
    expect(dependsIdx).toBeGreaterThan(-1);
    const envIdx = app.indexOf("environment:");
    const dependsBlock = app.slice(dependsIdx, envIdx > dependsIdx ? envIdx : undefined);
    expect(dependsBlock).toMatch(/redis:/);
    expect(dependsBlock).toMatch(/condition:\s*service_healthy/);
  });

  it("redis 服务不向宿主机暴露端口（仅容器内网访问）", () => {
    const redis = serviceBlock("redis");
    expect(redis).not.toMatch(/ports:/);
  });
});

describe(".env.example REDIS_URL 条目（TC-RATE-05）", () => {
  it("包含 REDIS_URL 示例条目", () => {
    expect(envExample).toMatch(/^REDIS_URL=.+/m);
  });

  it("注释说明单实例内存模式可用、多实例必须共享 Redis", () => {
    // 关键约束文案存在（单实例可省 / 多实例必须）
    expect(envExample).toMatch(/单实例/);
    expect(envExample).toMatch(/多实例/);
    expect(envExample).toMatch(/Redis/i);
  });
});

describe("docker-compose cron 调度服务（阶段3：compose 编排内置调度器）", () => {
  it("存在 cron 服务且复用 app 镜像（corps-web:latest，不新增构建产物）", () => {
    const cron = serviceBlock("cron");
    expect(cron, "未找到 cron 服务块").not.toBe("");
    expect(cron).toMatch(/image:\s*corps-web:latest/);
    expect(cron).not.toMatch(/build:/);
  });

  it("cron 以独立入口脚本启动（entrypoint-cron.sh）且随服务重启", () => {
    const cron = serviceBlock("cron");
    expect(cron).toMatch(/entrypoint:\s*\[?"?\/app\/entrypoint-cron\.sh/);
    expect(cron).toMatch(/restart:\s*unless-stopped/);
  });

  it("cron 依赖 app 健康后启动（避免 app 未就绪期空调用）", () => {
    const cron = serviceBlock("cron");
    expect(cron).toMatch(/depends_on:/);
    const depIdx = cron.indexOf("depends_on:");
    const depBlock = cron.slice(depIdx, depIdx + 120);
    expect(depBlock).toMatch(/app:/);
    expect(depBlock).toMatch(/condition:\s*service_healthy/);
  });

  it("cron 透传 CRON_SECRET 与 CRON_TZ", () => {
    const cron = serviceBlock("cron");
    expect(cron).toMatch(/CRON_SECRET:\s*\$\{CRON_SECRET:-\}/);
    expect(cron).toMatch(/CRON_TZ:\s*\$\{CRON_TZ:-UTC\}/);
  });

  it(".env.example 含 CRON_TZ 条目（时区可配置）", () => {
    expect(envExample).toMatch(/^CRON_TZ=/m);
  });

  it("entrypoint-cron.sh 计划表含全部三个 cron 路由（due-reminders / weekly-digest / cleanup-uploads）", () => {
    const cronSh = readFileSync(resolve(REPO_ROOT, "web/docker/entrypoint-cron.sh"), "utf8");
    expect(cronSh).toMatch(/\/api\/cron\/due-reminders/);
    expect(cronSh).toMatch(/\/api\/cron\/weekly-digest/);
    expect(cronSh).toMatch(/\/api\/cron\/cleanup-uploads/);
  });
});

describe("docker-compose 日历集成环境变量（审计 P1-B 防复发）", () => {
  // .env.example 中定义的服务端可选变量必须在 compose 的 app environment 透传——
  // 历史：支付类、CRON_SECRET、日历类 env 三次同类缺口（详见 ADR-006 关联审计）。
  // 新增服务端环境变量时同步维护此清单。
  const calendarEnvVars = [
    "CALENDAR_CRYPTO_KEY",
    "CALENDAR_STATE_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "OUTLOOK_CLIENT_ID",
    "OUTLOOK_CLIENT_SECRET",
    "OUTLOOK_REDIRECT_URI",
  ];

  it("compose app 服务透传全部日历集成变量", () => {
    const app = serviceBlock("app");
    for (const v of calendarEnvVars) {
      expect(app, `compose 缺 ${v}`).toMatch(new RegExp(`${v}:`));
    }
  });

  it(".env.example 与 compose 的日历变量名一一对应", () => {
    for (const v of calendarEnvVars) {
      expect(envExample, `.env.example 缺 ${v}`).toMatch(new RegExp(`^${v}=`, "m"));
    }
  });
});
