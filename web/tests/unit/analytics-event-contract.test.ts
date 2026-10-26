// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

import { ALLOWED_EVENT_NAMES } from "@/lib/analytics-whitelist";
import { CORE_EVENTS } from "@/lib/analytics-time";

/**
 * 埋点契约：**双向**一致（2026-10-20 P1-C 建正向，2026-10-25 补反向）。
 *
 * 正向（发出的名字必须进白名单）：服务端对白名单外的事件**静默丢弃**（设计如此——防脏数据）。
 * 一旦有人加了 `track("x")` 却忘了开闸，事件照样"打点成功"，只是永远查不到；
 * 这正是本 PR 实测到的真实缺陷：`workspace_create` 在 layout 里发了很久，
 * 白名单里却没有，等于这个漏斗步骤一直不存在。
 *
 * 反向（白名单里的名字必须有 emit 站点）：反方向的同一个坑**没有对称的症状**——
 * 名字挂在售卡上却没人发，事件表里那一步恒为 0 行，看板和 SQL 都只会读到"转化是 0"，
 * 没人怀疑是"根本没埋"。实测这一支漏了 10 个名字（占白名单 27%），其中
 * `create_comment` 还被 docs/analytics/METRICS-SQL-2026Q4.md 的活跃口径当分子消费：
 * 一个"看起来在算、实际上永远为 0"的指标比缺指标更坏。
 *
 * 所以两侧都从**源码扫描**，不维护第二份手写清单：
 *   - 客户端：`track("name", …)`；
 *   - 服务端：`trackServerEvent({ … name: "name" … })`；
 *   - SDK 自身：`enqueue({ … name: "name" … })` —— `session_start` 走这条
 *     （lib/analytics.ts 注释明写"不经 track 避免递归"），漏了它会把一个活着的事件
 *     判成死名字，即**门禁假阳性**：比没门禁更糟。
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
/**
 * `name:` 只在**同一个对象字面量**里才算这条调用的事件名，所以它必须落在开括号后的
 * 有限窗口内。无界懒匹配（旧写法 `[\s\S]*?`）会把**下一条**调用的 name 认领过来，
 * 于是"这条没埋"能被"隔壁那条"顶掉——反向断言正依赖这个判定，不能带这种误认领。
 * 窗口 400 字符（实测最长的真实调用远小于它）。
 */
const NAME_FIELD_WINDOW = 400;

function nameFieldRegex(callOpen: string): RegExp {
  return new RegExp(
    `${callOpen}\\(\\{[\\s\\S]{0,${NAME_FIELD_WINDOW}}?\\bname:\\s*"([a-z0-9_]+)"`,
    "g",
  );
}

const SCANNED = (() => {
  const client = new Map<string, string>();
  const server = new Map<string, string>();
  const sdk = new Map<string, string>();
  for (const file of SCAN_ROOTS.flatMap((r) => walk(join(WEB_ROOT, r)))) {
    const src = readFileSync(file, "utf-8");
    for (const m of src.matchAll(/\btrack\(\s*"([a-z0-9_]+)"/g)) {
      client.set(m[1], file);
    }
    for (const m of src.matchAll(nameFieldRegex("trackServerEvent"))) {
      server.set(m[1], file);
    }
    for (const m of src.matchAll(nameFieldRegex("enqueue"))) {
      sdk.set(m[1], file);
    }
  }
  return { client, server, sdk, all: new Map([...sdk, ...server, ...client]) };
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

  it("SDK 内部 enqueue() 的事件名全部在白名单里", () => {
    expect(SCANNED.sdk.size, "扫描不到 SDK 事件：探针坏了，空集不许判绿").toBeGreaterThan(0);
    expect(missing(SCANNED.sdk), "以下 SDK 事件未进白名单").toEqual([]);
  });

  it("反向：白名单里每个名字都能找到 emit 站点（否则该漏斗步骤恒为 0 行）", () => {
    expect(SCANNED.all.size, "扫描不到任何事件：探针坏了，空集不许判绿").toBeGreaterThan(0);
    const dead = [...ALLOWED_EVENT_NAMES].filter((n) => !SCANNED.all.has(n)).sort();
    expect(
      dead,
      `以下事件名只挂在白名单上、全仓没有 emit 站点 ⇒ 分析表里这一步永远是 0 行：${dead.join(", ")}`,
    ).toEqual([]);
  });

  it("反向断言自带射程：合成一个没人发的名字必须被抓到", () => {
    // 阳性对照：真实有 emit 站点的名字必须判"有着陆点"。
    // 没有这条，上面的绿可能只是探针扫不到任何东西（同文件「空集不许判绿」同一个道理）。
    expect(SCANNED.all.has("create_task"), "阳性对照失效：create_task 应当有 emit 站点").toBe(true);
    const synthetic = "synthetic_event_with_no_call_site";
    const dead = [...ALLOWED_EVENT_NAMES, synthetic].filter((n) => !SCANNED.all.has(n));
    // 只断言"合成名被抓到"，不断言 dead 恰好等于它：否则上一条真实断言一红，
    // 这条也会跟着红（同一个原因报两次红，反而看不出射程测试自己有没有坏）。
    expect(dead, "反向判据没有射程：合成死名字未被识出").toContain(synthetic);
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
