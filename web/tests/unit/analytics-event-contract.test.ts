// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

import { ALLOWED_EVENT_NAMES } from "@/lib/analytics-whitelist";
import { CORE_EVENTS } from "@/lib/analytics-time";

/**
 * 埋点契约：**代码里发的事件名必须都在白名单里**（2026-10-20 P1-C）。
 *
 * 为什么需要这条：服务端对白名单外的事件**静默丢弃**（设计如此——防脏数据）。
 * 一旦有人加了 `track("x")` 却忘了开闸，事件照样"打点成功"，只是永远查不到；
 * 这正是本 PR 实测到的真实缺陷：`workspace_create` 在 layout 里发了很久，
 * 白名单里却没有，等于这个漏斗步骤一直不存在。
 *
 * 所以这里从**源码扫描**两侧调用点，而不是维护第二份手写清单：
 *   - 客户端：`track("name", …)`；
 *   - 服务端：`trackServerEvent({ … name: "name" … })`。
 * 白名单本身是唯一事实源，新增事件必须同时改它；头部「计数：N 名」也被钉住，
 * 防止"加了名字但注释里的总数没改"这种慢性漂移。
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_ROOTS = ["app", "components", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules") continue;
      walk(full, out);
    } else if ([".ts", ".tsx"].includes(extname(ent.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 一次遍历、每文件一次读取，同时抽出两侧事件名。
 *
 * 为什么在意这个常数：初版每个断言各自重新遍历并 readFileSync（app+components+lib
 * 共 804 个 .ts/.tsx），本地实测 13.6s + 11.1s，而 vitest.config.ts 的 testTimeout
 * 是 45s 且 CI 用 pool: "forks" 并发跑几十个文件 —— 一个纯扫描测试吃掉 1/3 预算，
 * 是把 flake 请进来。扫描类测试的**耗时也是判据**，不能只断言它现在能过。
 */
const SCANNED = (() => {
  const client = new Map<string, string>();
  const server = new Map<string, string>();
  for (const file of SCAN_ROOTS.flatMap((r) => walk(join(WEB_ROOT, r)))) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(/\btrack\(\s*"([a-z0-9_]+)"/g)) {
      client.set(m[1], file);
    }
    // trackServerEvent({ ... name: "x" ... })：name 是必填字段，取第一次出现
    for (const m of src.matchAll(/trackServerEvent\(\{[\s\S]*?\bname:\s*"([a-z0-9_]+)"/g)) {
      server.set(m[1], file);
    }
  }
  return { client, server };
})();

function missing(names: Map<string, string>): string[] {
  return [...names]
    .filter(([name]) => !ALLOWED_EVENT_NAMES.has(name))
    .map(([n, f]) => `${n} (${f.replace(WEB_ROOT, "web")})`);
}

describe("埋点契约：事件名与白名单一致", () => {
  it("客户端 track() 的事件名全部在白名单里（否则服务端静默丢弃）", () => {
    expect(SCANNED.client.size, "扫描不到任何客户端事件：探针坏了，空集不许判绿").toBeGreaterThan(
      0,
    );
    expect(missing(SCANNED.client), "以下客户端事件未进白名单：它们在服务端会被静默丢弃").toEqual(
      [],
    );
  });

  it("服务端 trackServerEvent 的事件名全部在白名单里", () => {
    expect(SCANNED.server.size, "扫描不到任何服务端事件：探针坏了，空集不许判绿").toBeGreaterThan(
      0,
    );
    expect(missing(SCANNED.server), "以下服务端事件未进白名单").toEqual([]);
  });

  it("CORE_EVENTS 是白名单的子集（核心激活事件不能是脏名）", () => {
    for (const name of CORE_EVENTS) {
      expect(ALLOWED_EVENT_NAMES.has(name), `CORE_EVENTS 含白名单外事件 ${name}`).toBe(true);
    }
  });

  it("闭环与导出的三个事件已白名单化", () => {
    for (const name of ["workspace_create", "decision_landed", "export_pdf"]) {
      expect(ALLOWED_EVENT_NAMES.has(name), `缺少事件 ${name}`).toBe(true);
    }
  });

  it("白名单头部声明的数量与集合大小一致（防注释漂移）", () => {
    const src = readFileSync(join(WEB_ROOT, "lib/analytics-whitelist.ts"), "utf-8");
    const m = src.match(/计数[：:][^\n]*?(\d+)\s*名/);
    expect(m, "找不到白名单头部的「= N 名」计数声明").toBeTruthy();
    expect(Number(m?.[1])).toBe(ALLOWED_EVENT_NAMES.size);
  });
});
