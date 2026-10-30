// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  DEFAULT_LAYOUTS,
  SIZE_PRESETS,
  getDefaultLayout,
  isDashboardPrefData,
  isRGLLayout,
  normalizePrefData,
  type RGLItem,
} from "@/lib/default-layouts";

/**
 * 默认仪表盘布局契约（F3）：
 *  - 4 个角色各有默认布局，且 **同一角色内布局项不重叠**、不越 12 列网格
 *    （2026-10-10 用户反馈"默认布局不正常"的回归钉子：F7 换 12 列网格时
 *    w/x 乘 3 而 y 未同步、h 又乘 0.75，三套布局坐标互相重叠）
 *  - getDefaultLayout 对非法角色回退 viewer（最保守）
 *  - isRGLLayout / isDashboardPrefData / normalizePrefData 的脏数据防御
 */
describe("DEFAULT_LAYOUTS：角色布局的几何约束", () => {
  const roles = ["owner", "admin", "member", "viewer"] as const;

  it("四个角色都有布局且非空", () => {
    for (const r of roles) {
      expect(DEFAULT_LAYOUTS[r].length).toBeGreaterThan(0);
    }
  });

  it("每个布局项都在 12 列网格内（x + w ≤ 12 且非负）", () => {
    for (const r of roles) {
      for (const item of DEFAULT_LAYOUTS[r]) {
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.y).toBeGreaterThanOrEqual(0);
        expect(item.w).toBeGreaterThan(0);
        expect(item.h).toBeGreaterThan(0);
        expect(item.x + item.w).toBeLessThanOrEqual(12);
      }
    }
  });

  it("同一角色内布局项互不重叠（矩形相交检测）", () => {
    const overlaps = (a: RGLItem, b: RGLItem) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const r of roles) {
      const items = DEFAULT_LAYOUTS[r];
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          expect(overlaps(items[i], items[j]), `${r}: ${items[i].i} 与 ${items[j].i} 重叠`).toBe(
            false,
          );
        }
      }
    }
  });

  it("widget id 在角色内唯一", () => {
    for (const r of roles) {
      const ids = DEFAULT_LAYOUTS[r].map((i) => i.i);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("getDefaultLayout：角色回退", () => {
  it("合法角色返回该角色布局", () => {
    expect(getDefaultLayout("owner")).toBe(DEFAULT_LAYOUTS.owner);
    expect(getDefaultLayout("viewer")).toBe(DEFAULT_LAYOUTS.viewer);
  });

  it("非法 / 未知角色回退 viewer（最保守），不抛", () => {
    expect(getDefaultLayout("superuser")).toBe(DEFAULT_LAYOUTS.viewer);
    expect(getDefaultLayout("")).toBe(DEFAULT_LAYOUTS.viewer);
  });
});

describe("SIZE_PRESETS：尺寸循环预设", () => {
  it("S→M→L→XL 单调递增且都在 12 列内", () => {
    expect(SIZE_PRESETS.map((p) => p.label)).toEqual(["S", "M", "L", "XL"]);
    for (let i = 1; i < SIZE_PRESETS.length; i++) {
      expect(SIZE_PRESETS[i].w).toBeGreaterThan(SIZE_PRESETS[i - 1].w);
    }
    for (const p of SIZE_PRESETS) {
      expect(p.w).toBeLessThanOrEqual(12);
    }
  });
});

describe("脏数据防御：isRGLLayout / isDashboardPrefData / normalizePrefData", () => {
  const item = { i: "a", x: 0, y: 0, w: 1, h: 1 };

  it("isRGLLayout：数组且每项坐标齐备才为真", () => {
    expect(isRGLLayout([item])).toBe(true);
    expect(isRGLLayout([])).toBe(true);
    expect(isRGLLayout([{ i: "a" }])).toBe(false);
    expect(isRGLLayout({ items: [item] })).toBe(false);
    expect(isRGLLayout(null)).toBe(false);
    expect(isRGLLayout("x")).toBe(false);
  });

  it("isDashboardPrefData：对象 + items 合法才为真（数组不算）", () => {
    expect(isDashboardPrefData({ items: [item] })).toBe(true);
    expect(isDashboardPrefData({ items: [{ bad: true }] })).toBe(false);
    expect(isDashboardPrefData([item])).toBe(false);
    expect(isDashboardPrefData(null)).toBe(false);
  });

  it("normalizePrefData：三种输入 → 恒返回 { items, widgetConfigs }", () => {
    expect(normalizePrefData([item])).toEqual({ items: [item], widgetConfigs: {} });
    expect(normalizePrefData({ items: [item], widgetConfigs: { a: { k: 1 } } })).toEqual({
      items: [item],
      widgetConfigs: { a: { k: 1 } },
    });
    expect(normalizePrefData({ items: [item] })).toEqual({ items: [item], widgetConfigs: {} });
    expect(normalizePrefData(42)).toEqual({ items: [], widgetConfigs: {} });
    expect(normalizePrefData(undefined)).toEqual({ items: [], widgetConfigs: {} });
  });
});
