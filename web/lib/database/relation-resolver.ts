/**
 * 跨表关联（relation）与聚合（rollup）解析引擎
 *
 * 纯函数库，无 React 依赖，无 "use client"。
 *
 * ## 职责
 *
 * 1. **resolveRelationIds** —— 将 relation 字段值（record.data[relationFieldId]）
 *    规范化为记录 ID 数组。
 * 2. **resolveRelatedRecords** —— 根据 ID 数组从目标记录列表中筛选出关联记录。
 * 3. **computeRollup** —— 对关联记录的目标字段执行聚合计算
 *    （count / sum / avg / min / max / array）。
 * 4. **readRelationOptions / readRollupOptions** —— 安全读取字段 options JSON
 *    为强类型配置对象，非法配置返回 null。
 *
 * ## 安全约束
 *
 * - 所有 options 解析均做类型守卫，非法形状返回 null，不抛异常。
 * - computeRollup 对非数字值静默跳过（sum/avg/min/max），不抛异常。
 * - DatabaseRecord.data 是 Prisma JsonValue，读取时做 object 守卫。
 *
 * @example
 * const ids = resolveRelationIds(record.data[relationFieldId]);
 * const related = resolveRelatedRecords(ids, targetRecords);
 * const total = computeRollup(related, "price", "sum"); // 42
 */

import type { DatabaseField, DatabaseRecord } from "@prisma/client";

// ─── 类型定义 ───────────────────────────────────────────────

/** relation 字段的 options 配置 */
export interface RelationFieldOptions {
  /** 关联的目标 Database ID */
  targetDatabaseId: string;
  /** 在 UI 中显示的字段（默认第一个 text 字段） */
  displayFieldId?: string;
}

/** rollup 聚合方式 */
export type RollupAggregation =
  | "count"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "array";

/** rollup 字段的 options 配置 */
export interface RollupFieldOptions {
  /** 依赖的 relation 字段 ID */
  relationFieldId: string;
  /** 目标 Database 中要聚合的字段 ID */
  targetFieldId: string;
  /** 聚合方式 */
  aggregation: RollupAggregation;
}

// ─── 内部工具 ───────────────────────────────────────────────

/**
 * 安全读取 DatabaseRecord.data 中某个字段的值。
 * data 是 Prisma JsonValue，可能是 object / array / primitive。
 * 仅当 data 为非数组 object 时按字段键读取，否则返回 undefined。
 */
function readFieldValue(record: DatabaseRecord, fieldId: string): unknown {
  const data = record.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }
  return (data as Record<string, unknown>)[fieldId];
}

/**
 * 将值转为 number，非数字（含 NaN）返回 null。
 * - number 直接返回（NaN 除外）
 * - string 尝试 parseFloat，失败返回 null
 * - 其他类型返回 null
 */
function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isNaN(v) ? null : v;
  }
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * 将任意值转为 string（用于 array 聚合）。
 * null / undefined → ""，boolean → "true"/"false"，其余 → String(v)。
 */
function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** 判断值是否为合法的 RollupAggregation */
function isRollupAggregation(v: unknown): v is RollupAggregation {
  return (
    v === "count" ||
    v === "sum" ||
    v === "avg" ||
    v === "min" ||
    v === "max" ||
    v === "array"
  );
}

/** 安全将 field.options（Prisma JsonValue）转为 Record<string, unknown>，非法返回 null */
function optionsToRecord(options: unknown): Record<string, unknown> | null {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    return null;
  }
  return options as Record<string, unknown>;
}

// ─── 公共 API ───────────────────────────────────────────────

/**
 * 解析 relation 字段值（record.data[relationFieldId]）为记录 ID 数组。
 *
 * 接受任意类型输入，仅提取其中的 string 元素。非数组输入返回空数组。
 *
 * @example
 * resolveRelationIds(["a", "b", 3]) // ["a", "b"]
 * resolveRelationIds(null)           // []
 * resolveRelationIds("single")       // []
 */
export function resolveRelationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * 根据 relation IDs 和目标记录列表，返回关联的记录。
 *
 * 保持目标记录列表中的原始顺序（而非 IDs 数组顺序），使 UI 展示稳定。
 * 使用 Set 实现 O(n+m) 查找。
 *
 * @example
 * resolveRelatedRecords(["a", "b"], [{id:"b"}, {id:"a"}, {id:"c"}])
 * // [{id:"b"}, {id:"a"}]  —— 按目标列表顺序
 */
export function resolveRelatedRecords(
  relationIds: string[],
  targetRecords: DatabaseRecord[],
): DatabaseRecord[] {
  if (relationIds.length === 0) return [];
  const idSet = new Set(relationIds);
  return targetRecords.filter((r) => idSet.has(r.id));
}

/**
 * 计算 rollup 聚合值。
 *
 * ## 聚合逻辑
 *
 * - **count**: 返回关联记录数量（number），忽略 targetFieldId
 * - **sum**: 对目标字段值求和（number，非数字值跳过）
 * - **avg**: 平均值（number，无有效数字时返回 null）
 * - **min**: 最小值（number，无有效数字时返回 null）
 * - **max**: 最大值（number，无有效数字时返回 null）
 * - **array**: 返回所有值的字符串数组（string[]，每个值经 toStr 转换）
 *
 * 空记录集：
 * - count → 0
 * - sum → 0
 * - avg/min/max → null
 * - array → []
 *
 * @example
 * computeRollup(records, "price", "sum")   // 42
 * computeRollup(records, "price", "avg")   // 14
 * computeRollup(records, "name", "array")  // ["Alice", "Bob"]
 * computeRollup(records, "_", "count")     // 3
 */
export function computeRollup(
  relatedRecords: DatabaseRecord[],
  targetFieldId: string,
  aggregation: RollupAggregation,
): number | string | string[] | null {
  switch (aggregation) {
    case "count":
      return relatedRecords.length;

    case "sum": {
      let sum = 0;
      for (const r of relatedRecords) {
        const n = toNumberOrNull(readFieldValue(r, targetFieldId));
        if (n !== null) sum += n;
      }
      return sum;
    }

    case "avg": {
      let sum = 0;
      let count = 0;
      for (const r of relatedRecords) {
        const n = toNumberOrNull(readFieldValue(r, targetFieldId));
        if (n !== null) {
          sum += n;
          count++;
        }
      }
      return count === 0 ? null : sum / count;
    }

    case "min": {
      let min: number | null = null;
      for (const r of relatedRecords) {
        const n = toNumberOrNull(readFieldValue(r, targetFieldId));
        if (n !== null && (min === null || n < min)) {
          min = n;
        }
      }
      return min;
    }

    case "max": {
      let max: number | null = null;
      for (const r of relatedRecords) {
        const n = toNumberOrNull(readFieldValue(r, targetFieldId));
        if (n !== null && (max === null || n > max)) {
          max = n;
        }
      }
      return max;
    }

    case "array": {
      return relatedRecords.map((r) => toStr(readFieldValue(r, targetFieldId)));
    }

    default:
      return null;
  }
}

/**
 * 读取 relation 字段配置。
 *
 * 从 DatabaseField.options（JSON）中解析出 RelationFieldOptions。
 * 必须包含 `targetDatabaseId: string`，可选 `displayFieldId: string`。
 * 非法配置返回 null。
 *
 * @example
 * const opts = readRelationOptions(field);
 * if (opts) { /* opts.targetDatabaseId 可安全使用 *\/ }
 */
export function readRelationOptions(
  field: DatabaseField,
): RelationFieldOptions | null {
  const raw = optionsToRecord(field.options);
  if (raw === null) return null;

  const targetDatabaseId = raw.targetDatabaseId;
  if (typeof targetDatabaseId !== "string") return null;

  const result: RelationFieldOptions = { targetDatabaseId };

  if (typeof raw.displayFieldId === "string") {
    result.displayFieldId = raw.displayFieldId;
  }

  return result;
}

/**
 * 读取 rollup 字段配置。
 *
 * 从 DatabaseField.options（JSON）中解析出 RollupFieldOptions。
 * 必须包含 `relationFieldId: string`、`targetFieldId: string`、
 * `aggregation: RollupAggregation`。非法配置返回 null。
 *
 * @example
 * const opts = readRollupOptions(field);
 * if (opts) { computeRollup(records, opts.targetFieldId, opts.aggregation) }
 */
export function readRollupOptions(
  field: DatabaseField,
): RollupFieldOptions | null {
  const raw = optionsToRecord(field.options);
  if (raw === null) return null;

  const relationFieldId = raw.relationFieldId;
  const targetFieldId = raw.targetFieldId;
  const aggregation = raw.aggregation;

  if (typeof relationFieldId !== "string") return null;
  if (typeof targetFieldId !== "string") return null;
  if (!isRollupAggregation(aggregation)) return null;

  return { relationFieldId, targetFieldId, aggregation };
}