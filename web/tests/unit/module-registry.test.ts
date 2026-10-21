// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  DEFAULT_VISIBLE_MODULE_IDS,
  MODULE_GROUPS,
  WORKSPACE_MODULES,
  moduleHref,
  modulesForRole,
  modulesInGroup,
  optionalModulesForRole,
  primaryModulesForRole,
} from "@/lib/modules/registry";
import { MODULE_ICONS } from "@/lib/modules/icons";

/**
 * 模块注册表契约（2026-10-20 P1-A 地基）。
 *
 * 这张表将成为侧栏、Cmd+K、设置页与计费矩阵的唯一事实源。它最容易坏的方式
 * 不是类型错，而是**表与仓库里的真实页面/词条悄悄漂移**：删了一个页面、改了一个
 * 路由、翻译键没补，界面才会在运行时炸。所以这里把四件事钉成机械断言：
 *   1. 每个模块都能在磁盘上找到对应 page.tsx（没有指向空路由的入口）；
 *   2. 每个 labelKey 在 zh/en 两个 messages 里都存在（不会显示原始 key）；
 *   3. 每个 icon 键都在图标表里（编译期已保证，这里再钉一次防绕过）；
 *   4. **组内顺序与改造前侧栏逐项一致**——本阶段是像素不变的纯重构，顺序一变
 *      dashboard 的 Playwright 视觉基线就会红（基线是 linux 产物，本机无法重生成）。
 *      P1-B 改默认可见性时，这一条会作为"有意识的变更"一起改。
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const APP_WORKSPACE = join(WEB_ROOT, "app/[locale]/w/[wid]");

function navMessages(locale: "zh" | "en"): Record<string, string> {
  const raw = JSON.parse(readFileSync(join(WEB_ROOT, `messages/${locale}.json`), "utf-8")) as {
    nav: { menu: Record<string, string> };
  };
  return raw.nav.menu;
}

describe("模块注册表：结构与秩序", () => {
  it("31 个静态模块，id 与 path 均唯一", () => {
    expect(WORKSPACE_MODULES).toHaveLength(31);
    expect(new Set(WORKSPACE_MODULES.map((m) => m.id)).size).toBe(31);
    expect(new Set(WORKSPACE_MODULES.map((m) => m.path)).size).toBe(31);
  });

  it("组内顺序与改造前侧栏逐项一致（本阶段像素不变的契约）", () => {
    expect(MODULE_GROUPS.map((g) => g.id)).toEqual([
      "core",
      "collaboration",
      "knowledge",
      "planning",
      "ai",
      "admin",
    ]);
    expect(modulesInGroup("core").map((m) => m.id)).toEqual([
      "overview",
      "board",
      "my-tasks",
      "im",
      "decisions",
    ]);
    expect(modulesInGroup("collaboration").map((m) => m.id)).toEqual([
      "meetings",
      "meeting-minutes",
      "approvals",
      "announcements",
      "calendar",
      "contacts",
    ]);
    expect(modulesInGroup("knowledge").map((m) => m.id)).toEqual([
      "documents",
      "files",
      "wiki",
      "whiteboards",
      "databases",
      "forms",
      "recycle-bin",
    ]);
    expect(modulesInGroup("planning").map((m) => m.id)).toEqual([
      "okr",
      "workflows",
      "templates",
      "time-tracking",
    ]);
    expect(modulesInGroup("ai").map((m) => m.id)).toEqual([
      "ai-tools",
      "insight",
      "knowledge-qa",
      "daily-report",
      "announcement-draft",
    ]);
    expect(modulesInGroup("admin").map((m) => m.id)).toEqual([
      "members",
      "billing",
      "analytics",
      "settings",
    ]);
  });

  it("分组表覆盖每个模块，且每个分组非空", () => {
    const groupIds = new Set(MODULE_GROUPS.map((g) => g.id));
    for (const m of WORKSPACE_MODULES) {
      expect(groupIds.has(m.group), `模块 ${m.id} 的分组 ${m.group} 不在 MODULE_GROUPS 里`).toBe(
        true,
      );
    }
    for (const g of MODULE_GROUPS) {
      expect(modulesInGroup(g.id).length, `分组 ${g.id} 为空`).toBeGreaterThan(0);
    }
  });

  it("viewer 隐藏成员/计费/分析三项，其余 28 项可见", () => {
    const hidden = WORKSPACE_MODULES.filter((m) => m.viewerHidden).map((m) => m.id);
    expect(hidden.sort()).toEqual(["analytics", "billing", "members"]);
    expect(modulesForRole("viewer")).toHaveLength(28);
    expect(modulesForRole("member")).toHaveLength(31);
  });

  /**
   * P1-B 默认可见性：首屏 = 核心 6 + 管理 4，其余 21 项进「更多」。
   * 这里钉三件事：数量、**不丢不重**（两边并集恰好 31）、以及「可选 ≠ 删除」——
   * 21 项仍全部在更多里、仍各自有页（上面那条 page.tsx 断言对全表生效）。
   */
  it("首屏 10 项 / 「更多」21 项，两边并集恰好 31、互不重叠", () => {
    const primary = primaryModulesForRole("member");
    const optional = optionalModulesForRole("member");
    expect(primary).toHaveLength(10);
    expect(optional).toHaveLength(21);
    // 顺序不重要（注册表顺序 ≠ 清单书写顺序），集合必须等于声明的首屏清单
    expect(primary.map((m) => m.id).sort()).toEqual([...DEFAULT_VISIBLE_MODULE_IDS].sort());

    const ids = [...primary, ...optional].map((m) => m.id);
    expect(ids).toHaveLength(31);
    expect(new Set(ids).size, "有模块同时出现在首屏与「更多」，或两处都缺席").toBe(31);

    // 管理组固定压在首屏末尾（documents 属于知识组但默认可见，不能按 group 推导）
    expect(primary.slice(-4).map((m) => m.id)).toEqual([
      "members",
      "billing",
      "analytics",
      "settings",
    ]);
    // 「可选 ≠ 删除」：文档虽在知识组，仍必须出现在首屏
    expect(primary.map((m) => m.id)).toContain("documents");
  });

  it("viewer 的首屏少 3 项（成员/计费/分析），「更多」不变", () => {
    expect(primaryModulesForRole("viewer")).toHaveLength(7);
    expect(primaryModulesForRole("viewer").map((m) => m.id)).not.toContain("members");
    expect(optionalModulesForRole("viewer")).toHaveLength(21);
  });

  it("moduleHref 拼出工作区路径（根模块不带多余斜杠）", () => {
    const overview = WORKSPACE_MODULES.find((m) => m.id === "overview")!;
    const board = WORKSPACE_MODULES.find((m) => m.id === "board")!;
    expect(moduleHref(overview, "w1")).toBe("/w/w1");
    expect(moduleHref(board, "w1")).toBe("/w/w1/board");
  });
});

describe("模块注册表：与真实页面 / 词条 / 图标一致", () => {
  it("每个模块都有对应的 page.tsx（不存在指向空路由的导航项）", () => {
    for (const m of WORKSPACE_MODULES) {
      const file = join(APP_WORKSPACE, m.path.replace(/^\//, ""), "page.tsx");
      expect(existsSync(file), `模块 ${m.id} 的页面不存在：${file}`).toBe(true);
    }
  });

  it("每个 labelKey 在 zh/en 的 nav.menu 里都存在（不会显示原始 key）", () => {
    for (const locale of ["zh", "en"] as const) {
      const menu = navMessages(locale);
      for (const m of WORKSPACE_MODULES) {
        const short = m.labelKey.replace(/^menu\./, "");
        expect(menu[short], `${locale} 缺少词条 nav.menu.${short}（模块 ${m.id}）`).toBeTruthy();
      }
      for (const g of MODULE_GROUPS) {
        if (!g.labelKey) continue;
        const short = g.labelKey.replace(/^menu\./, "");
        expect(menu[short], `${locale} 缺少分组词条 nav.menu.${short}`).toBeTruthy();
      }
    }
  });

  it("每个图标键都在 MODULE_ICONS 里（渲染层不会拿到 undefined）", () => {
    for (const m of WORKSPACE_MODULES) {
      expect(MODULE_ICONS[m.icon], `模块 ${m.id} 的图标键 ${m.icon} 不存在`).toBeTruthy();
    }
  });
});
