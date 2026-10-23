// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  invalidOptionalModuleIds,
  readSidebarSettings,
  withSidebarSettings,
} from "@/lib/workspace-settings";
import { OPTIONAL_MODULE_IDS } from "@/lib/modules/registry";

/**
 * 工作区设置（`workspaces.settings` JSON）的读写边界（P1-B2）。
 *
 * 这类测试要钉的不是"正常路径能跑"，而是**脏数据不许穿透**：
 * JSON 列没有类型约束，任何写入路径都能塞进首屏模块 id、不存在的模块 id、
 * 重复 id、甚至字符串/数组。读取侧如果原样信任，侧栏就会出现不存在的入口，
 * 或者把「概览」挤进可选列表。
 */
describe("workspace-settings：读取侧收口", () => {
  it("空配置 / 缺失 → 空启用列表（= 全部收在「更多」）", () => {
    expect(readSidebarSettings({}).enabledModules).toEqual([]);
    expect(readSidebarSettings(null).enabledModules).toEqual([]);
    expect(readSidebarSettings(undefined).enabledModules).toEqual([]);
    expect(readSidebarSettings({ sidebar: {} }).enabledModules).toEqual([]);
  });

  it("只接受可选模块 id：首屏模块与不存在的 id 一律丢弃", () => {
    const s = readSidebarSettings({
      sidebar: { enabledModules: ["wiki", "overview", "not-a-module", "okr"] },
    });
    expect(s.enabledModules).toEqual(["wiki", "okr"]);
  });

  it("重复 id 去重，且保持输入顺序", () => {
    const s = readSidebarSettings({
      sidebar: { enabledModules: ["okr", "wiki", "okr"] },
    });
    expect(s.enabledModules).toEqual(["okr", "wiki"]);
  });

  it("脏形态（字符串 / 数组 / 数字）降级为空，不抛错", () => {
    expect(readSidebarSettings("oops").enabledModules).toEqual([]);
    expect(readSidebarSettings([1, 2, 3]).enabledModules).toEqual([]);
    expect(readSidebarSettings({ sidebar: { enabledModules: "wiki" } }).enabledModules).toEqual([]);
    expect(readSidebarSettings({ sidebar: 42 }).enabledModules).toEqual([]);
  });
});

describe("workspace-settings：写入侧合并", () => {
  it("只改 sidebar.enabledModules，其它未知键原样保留（不做整对象覆盖）", () => {
    const raw = { future: { flag: true }, sidebar: { width: 240 } };
    const next = withSidebarSettings(raw, ["wiki"]);
    expect(next).toEqual({
      future: { flag: true },
      sidebar: { width: 240, enabledModules: ["wiki"] },
    });
  });

  it("写入侧同样过滤非法 id 与重复项（最后一道兜底）", () => {
    const next = withSidebarSettings({}, ["wiki", "overview", "wiki", "nope"]);
    expect((next.sidebar as { enabledModules: string[] }).enabledModules).toEqual(["wiki"]);
  });

  it("空数组 = 清空启用（不删掉 sidebar 子树）", () => {
    const next = withSidebarSettings({ sidebar: { width: 240, enabledModules: ["okr"] } }, []);
    expect(next.sidebar).toEqual({ width: 240, enabledModules: [] });
  });

  it("invalidOptionalModuleIds 报出全部非法项，供路由回 400", () => {
    expect(invalidOptionalModuleIds(["wiki", "overview", "nope"])).toEqual(["overview", "nope"]);
    expect(invalidOptionalModuleIds(["wiki", "okr"])).toEqual([]);
  });

  it("可选模块清单本身非空且不含首屏模块（探针自证）", () => {
    expect(OPTIONAL_MODULE_IDS.length).toBeGreaterThan(0);
    expect(OPTIONAL_MODULE_IDS).not.toContain("overview");
    expect(OPTIONAL_MODULE_IDS).not.toContain("settings");
  });
});
