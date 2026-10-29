// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  resolveRelationIds,
  resolveRelatedRecords,
  computeRollup,
  readRelationOptions,
  readRollupOptions,
} from "@/lib/database/relation-resolver";
import type { DatabaseField, DatabaseRecord } from "@prisma/client";

/**
 * 数据库关联/汇总解析器（lib/database/relation-resolver.ts）的契约。
 *
 * 该模块是 relation/rollup 字段的纯计算层（不碰 Prisma client），
 * 契约重点是：
 *  - resolveRelationIds 对任意脏输入（非数组、混合类型）都只产出 string[]
 *  - resolveRelatedRecords 保持目标记录列表顺序（UI 展示稳定，不随引用顺序跳）
 *  - computeRollup 六种聚合对空记录集与非法数字都有定义好的兜底
 *  - read*Options 对非法 JSON 配置返回 null（调用方据此降级，而不是拿到一半字段）
 */

function rec(id: string, data: Record<string, unknown>): DatabaseRecord {
  return { id, data } as unknown as DatabaseRecord;
}

function field(options: unknown): DatabaseField {
  return { options } as unknown as DatabaseField;
}

describe("resolveRelationIds", () => {
  it("从数组中提取 string 元素，忽略其他类型", () => {
    expect(resolveRelationIds(["a", "b", 3, null, true])).toEqual(["a", "b"]);
  });

  it("非数组输入返回空数组（字符串、null、对象都不当单值处理）", () => {
    expect(resolveRelationIds("single")).toEqual([]);
    expect(resolveRelationIds(null)).toEqual([]);
    expect(resolveRelationIds({ a: 1 })).toEqual([]);
    expect(resolveRelationIds([])).toEqual([]);
  });
});

describe("resolveRelatedRecords", () => {
  it("按目标记录列表的原始顺序返回（而非 ids 数组顺序）", () => {
    const records = [rec("b", {}), rec("a", {}), rec("c", {})];
    expect(resolveRelatedRecords(["a", "b"], records)).toEqual([rec("b", {}), rec("a", {})]);
  });

  it("空 ids 直接返回空数组（不遍历目标列表）", () => {
    const records = [rec("a", {})];
    expect(resolveRelatedRecords([], records)).toEqual([]);
  });

  it("目标记录含未引用的项时被过滤", () => {
    const records = [rec("a", {}), rec("c", {})];
    expect(resolveRelatedRecords(["a"], records)).toEqual([rec("a", {})]);
  });
});

describe("computeRollup —— 六种聚合", () => {
  const records = [
    rec("r1", { price: "10", name: "Alice" }),
    rec("r2", { price: 5, name: "Bob" }),
    rec("r3", { price: "不是数字", name: null }),
  ];

  it("count 返回记录数，忽略 targetFieldId", () => {
    expect(computeRollup(records, "_", "count")).toBe(3);
    expect(computeRollup([], "_", "count")).toBe(0);
  });

  it("sum 跳过非数字值（字符串数字参与求和）", () => {
    expect(computeRollup(records, "price", "sum")).toBe(15);
    expect(computeRollup([], "price", "sum")).toBe(0);
  });

  it("avg 无有效数字时返回 null", () => {
    expect(computeRollup(records, "price", "avg")).toBe(7.5);
    expect(computeRollup([rec("r3", { price: "x" })], "price", "avg")).toBeNull();
    expect(computeRollup([], "price", "avg")).toBeNull();
  });

  it("min / max 无有效数字时返回 null", () => {
    expect(computeRollup(records, "price", "min")).toBe(5);
    expect(computeRollup(records, "price", "max")).toBe(10);
    expect(computeRollup([], "price", "min")).toBeNull();
    expect(computeRollup([], "price", "max")).toBeNull();
  });

  it("array 把每个值转成字符串（null → 空串）", () => {
    expect(computeRollup(records, "name", "array")).toEqual(["Alice", "Bob", ""]);
    expect(computeRollup([], "name", "array")).toEqual([]);
  });

  it("record.data 非对象（数组/原始值/字符串数字字段）时字段读出 undefined，聚合安全降级", () => {
    const bad = [{ id: "x", data: [1, 2] }, { id: "y", data: "str" }, { id: "z" }] as unknown as DatabaseRecord[];
    expect(computeRollup(bad, "price", "sum")).toBe(0);
    expect(computeRollup(bad, "price", "avg")).toBeNull();
    expect(computeRollup(bad, "price", "array")).toEqual(["", "", ""]);
  });

  it("未知聚合方式返回 null（default 分支兜底）", () => {
    expect(computeRollup(records, "price", "median" as never)).toBeNull();
  });
});

describe("readRelationOptions", () => {
  it("合法配置（含可选 displayFieldId）", () => {
    const opts = readRelationOptions(
      field({ targetDatabaseId: "db-1", displayFieldId: "f-title" }),
    );
    expect(opts).toEqual({ targetDatabaseId: "db-1", displayFieldId: "f-title" });
  });

  it("缺 displayFieldId 时只返回 targetDatabaseId", () => {
    expect(readRelationOptions(field({ targetDatabaseId: "db-1" }))).toEqual({
      targetDatabaseId: "db-1",
    });
  });

  it("targetDatabaseId 非 string 返回 null", () => {
    expect(readRelationOptions(field({ targetDatabaseId: 123 }))).toBeNull();
    expect(readRelationOptions(field({}))).toBeNull();
  });

  it("options 非对象（null/数组/原始值）返回 null", () => {
    expect(readRelationOptions(field(null))).toBeNull();
    expect(readRelationOptions(field([1, 2]))).toBeNull();
    expect(readRelationOptions(field("db-1"))).toBeNull();
  });

  it("displayFieldId 非 string 时被忽略（不进结果）", () => {
    expect(
      readRelationOptions(field({ targetDatabaseId: "db-1", displayFieldId: 42 })),
    ).toEqual({ targetDatabaseId: "db-1" });
  });
});

describe("readRollupOptions", () => {
  it("合法配置原样返回", () => {
    const opts = readRollupOptions(
      field({ relationFieldId: "f-rel", targetFieldId: "f-price", aggregation: "sum" }),
    );
    expect(opts).toEqual({ relationFieldId: "f-rel", targetFieldId: "f-price", aggregation: "sum" });
  });

  it("任一必需字段缺失或类型错误返回 null", () => {
    expect(readRollupOptions(field({ relationFieldId: "f-rel", targetFieldId: "f-price" }))).toBeNull();
    expect(
      readRollupOptions(field({ relationFieldId: "f-rel", aggregation: "sum" })),
    ).toBeNull();
    expect(
      readRollupOptions(field({ targetFieldId: "f-price", aggregation: "sum" })),
    ).toBeNull();
    expect(
      readRollupOptions(field({ relationFieldId: 1, targetFieldId: "f-price", aggregation: "sum" })),
    ).toBeNull();
  });

  it("aggregation 不在六种合法值内返回 null", () => {
    expect(
      readRollupOptions(field({ relationFieldId: "f-rel", targetFieldId: "f", aggregation: "avg42" })),
    ).toBeNull();
    expect(
      readRollupOptions(field({ relationFieldId: "f-rel", targetFieldId: "f", aggregation: 1 })),
    ).toBeNull();
  });

  it("六种聚合方式都被接受", () => {
    for (const agg of ["count", "sum", "avg", "min", "max", "array"] as const) {
      expect(
        readRollupOptions(field({ relationFieldId: "r", targetFieldId: "t", aggregation: agg })),
      ).toEqual({ relationFieldId: "r", targetFieldId: "t", aggregation: agg });
    }
  });
});
