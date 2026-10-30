// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  buildPrefData,
  extractPref,
  importLayoutSchema,
  layoutItemSchema,
  putLayoutSchema,
} from "@/lib/dashboard-layout-helpers";

/**
 * Widget 仪表盘布局 helpers 契约（F3）：
 *  - zod schema 是 PUT /layout 与 POST /layout/import 的输入闸门
 *  - extractPref / buildPrefData 负责「旧数组格式 ↔ 新复合格式」的兼容层
 *    （Prisma Json 字段不迁 schema 的前提下做向前/向后兼容）
 */
describe("layoutItemSchema：RGL 布局项校验", () => {
  it("接受合法项（含可选 minW/minH）", () => {
    expect(
      layoutItemSchema.parse({ i: "task-stats", x: 0, y: 0, w: 3, h: 4, minW: 2, minH: 2 }),
    ).toEqual({ i: "task-stats", x: 0, y: 0, w: 3, h: 4, minW: 2, minH: 2 });
  });

  it("拒绝：空 id / 负坐标 / 非整数 / w,h<1", () => {
    expect(layoutItemSchema.safeParse({ i: "", x: 0, y: 0, w: 1, h: 1 }).success).toBe(false);
    expect(layoutItemSchema.safeParse({ i: "a", x: -1, y: 0, w: 1, h: 1 }).success).toBe(false);
    expect(layoutItemSchema.safeParse({ i: "a", x: 0.5, y: 0, w: 1, h: 1 }).success).toBe(false);
    expect(layoutItemSchema.safeParse({ i: "a", x: 0, y: 0, w: 0, h: 1 }).success).toBe(false);
    expect(layoutItemSchema.safeParse({ i: "a", x: 0, y: 0, w: 1, h: 0 }).success).toBe(false);
  });
});

describe("putLayoutSchema / importLayoutSchema", () => {
  it("PUT：layout 至少 1 项，widgetConfigs 可选", () => {
    expect(putLayoutSchema.safeParse({ layout: [] }).success).toBe(false);
    const ok = putLayoutSchema.safeParse({
      layout: [{ i: "a", x: 0, y: 0, w: 1, h: 1 }],
      breakpoint: "lg",
      widgetConfigs: { a: { range: "7d" } },
    });
    expect(ok.success).toBe(true);
  });

  it("import：name 最长 100（仅审计用途，超长拒绝）", () => {
    const base = { layout: [{ i: "a", x: 0, y: 0, w: 1, h: 1 }] };
    expect(importLayoutSchema.safeParse({ ...base, name: "x".repeat(100) }).success).toBe(true);
    expect(importLayoutSchema.safeParse({ ...base, name: "x".repeat(101) }).success).toBe(false);
  });
});

describe("extractPref / buildPrefData：新旧格式兼容层", () => {
  const item = { i: "burndown", x: 0, y: 0, w: 12, h: 4 };

  it("旧格式（裸 RGLItem[]）→ items + 空 widgetConfigs", () => {
    expect(extractPref([item])).toEqual({ layout: [item], widgetConfigs: {} });
  });

  it("新格式（复合对象）→ 原样提取；widgetConfigs 缺失补 {}", () => {
    expect(extractPref({ items: [item], widgetConfigs: { burndown: { range: "30d" } } })).toEqual({
      layout: [item],
      widgetConfigs: { burndown: { range: "30d" } },
    });
    expect(extractPref({ items: [item] })).toEqual({ layout: [item], widgetConfigs: {} });
  });

  it("非法值（null / 字符串 / 缺坐标的数组）→ 空布局兜底，不抛", () => {
    expect(extractPref(null)).toEqual({ layout: [], widgetConfigs: {} });
    expect(extractPref("garbage")).toEqual({ layout: [], widgetConfigs: {} });
    expect(extractPref([{ i: "a" }])).toEqual({ layout: [], widgetConfigs: {} });
  });

  it("buildPrefData：无 widgetConfigs 时补 {}", () => {
    expect(buildPrefData([item])).toEqual({ items: [item], widgetConfigs: {} });
    expect(buildPrefData([item], { a: { k: 1 } })).toEqual({
      items: [item],
      widgetConfigs: { a: { k: 1 } },
    });
  });

  it("往返：buildPrefData → extractPref 恒等", () => {
    const data = buildPrefData([item], { a: { k: 1 } });
    expect(extractPref(data)).toEqual({ layout: [item], widgetConfigs: { a: { k: 1 } } });
  });
});
