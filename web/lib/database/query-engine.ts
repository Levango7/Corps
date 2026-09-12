/**
 * 多维表格查询引擎 —— 纯函数库，无 React 依赖。
 *
 * 可被 API 路由（Node.js）和前端组件共用，负责对 DatabaseRecord 数组
 * 应用筛选（filter）、排序（sort）和分组（group）。
 *
 * 设计：
 *  - 纯函数，无副作用，不修改输入数组（排序返回新数组）
 *  - 类型感知：根据 DatabaseField.type 做类型感知比较与匹配
 *  - 筛选支持 AND/OR 逻辑组合
 *  - 排序支持多字段优先级（sorts 数组顺序即优先级递减）
 *  - 分组支持单值与多值（multiselect/user）字段，一条记录可属多个分组
 *
 * 来源：Phase 3D 多维表格筛选/排序/分组
 */

// ─── 类型定义 ────────────────────────────────────────────────

/** 字段类型（与 Prisma DatabaseField.type 对应，运行时为 string） */
export type FieldType =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "checkbox"
  | "user"
  | "url"
  | "email";

/** 筛选操作符 */
export type FilterOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "starts_with"
  | "is_empty"
  | "is_not_empty"
  | "before"
  | "after"
  | "within"
  | "is"
  | "is_not";

/** 筛选条件 */
export interface FilterCondition {
  fieldId: string;
  operator: FilterOperator;
  value: unknown;
}

/** 排序条件 */
export interface SortCondition {
  fieldId: string;
  direction: "asc" | "desc";
}

/** 筛选 + 排序 + 分组查询选项 */
export interface QueryOptions {
  filters?: FilterCondition[];
  filterLogic?: "AND" | "OR";
  sorts?: SortCondition[];
  groupFieldId?: string;
  /** 当前用户 ID，用于解析 "current_user" 筛选值（is/is_not 操作符） */
  currentUserId?: string;
}

/** 多维表格字段（与 Prisma DatabaseField 形状一致） */
export interface DatabaseField {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  options: unknown;
  sortOrder: number;
}

/** 多维表格记录（与 Prisma DatabaseRecord 形状一致，data 为 { fieldId: value }） */
export interface DatabaseRecord {
  id: string;
  databaseId: string;
  data: Record<string, unknown>;
  sortOrder: number;
}

/** 分组结果 */
export interface GroupedRecords {
  key: string;
  records: DatabaseRecord[];
}

/** select 字段选项 */
export interface SelectOption {
  id: string;
  label: string;
  color?: string;
}

/** 查询结果 */
export interface QueryResult {
  groups: GroupedRecords[];
  total: number;
}

// ─── 内部常量 ────────────────────────────────────────────────

/** 未分组标签（值为空时归入此分组） */
const UNGROUPED_KEY = "未分组";

/** 全部分组标签（未指定 groupFieldId 时的单组） */
const ALL_GROUP_KEY = "全部";

// ─── 内部 helper ─────────────────────────────────────────────

/** 从记录中取字段值（防御 data 为空） */
function getFieldValue(record: DatabaseRecord, fieldId: string): unknown {
  if (typeof record.data !== "object" || record.data === null) return undefined;
  return record.data[fieldId];
}

/** 判断空值：null/undefined/空字符串/空数组 */
function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

/** 严格相等，处理数组（multiselect 无序相等） */
function strictEquals(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x) => b.includes(x));
  }
  return a === b;
}

/** 数符号（-1/0/1），避免大数减法溢出 */
function sign(n: number): number {
  return n < 0 ? -1 : n > 0 ? 1 : 0;
}

/** 值转 Date，无效返回 null */
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** 日期比较，空值排后，返回 sign（-1/0/1） */
function compareDates(a: unknown, b: unknown): number {
  const da = toDate(a);
  const db = toDate(b);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return sign(da.getTime() - db.getTime());
}

/**
 * within 预设范围：返回 [start, end] 闭区间。
 * 用原生 Date API 计算，周以周一为起始。
 */
function getPresetRange(preset: string, now: Date): [Date, Date] | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (preset) {
    case "this_week": {
      const day = now.getDay(); // 0=Sun..6=Sat
      const offset = day === 0 ? 6 : day - 1; // 周一为起始
      return [
        new Date(y, m, d - offset, 0, 0, 0, 0),
        new Date(y, m, d - offset + 6, 23, 59, 59, 999),
      ];
    }
    case "this_month":
      return [new Date(y, m, 1, 0, 0, 0, 0), new Date(y, m + 1, 0, 23, 59, 59, 999)];
    case "this_year":
      return [new Date(y, 0, 1, 0, 0, 0, 0), new Date(y, 11, 31, 23, 59, 59, 999)];
    case "this_quarter": {
      const q = Math.floor(m / 3);
      const startMonth = q * 3;
      return [
        new Date(y, startMonth, 1, 0, 0, 0, 0),
        new Date(y, startMonth + 3, 0, 23, 59, 59, 999),
      ];
    }
    case "last_week": {
      const day = now.getDay();
      const offset = day === 0 ? 6 : day - 1;
      return [
        new Date(y, m, d - offset - 7, 0, 0, 0, 0),
        new Date(y, m, d - offset - 1, 23, 59, 59, 999),
      ];
    }
    case "last_month":
      return [new Date(y, m - 1, 1, 0, 0, 0, 0), new Date(y, m, 0, 23, 59, 59, 999)];
    case "last_year":
      return [new Date(y - 1, 0, 1, 0, 0, 0, 0), new Date(y - 1, 11, 31, 23, 59, 59, 999)];
    case "last_7_days":
      return [new Date(y, m, d - 6, 0, 0, 0, 0), now];
    case "last_30_days":
      return [new Date(y, m, d - 29, 0, 0, 0, 0), now];
    default:
      return null;
  }
}

/** within 范围匹配 */
function withinRange(value: unknown, preset: unknown): boolean {
  const date = toDate(value);
  if (date === null) return false;
  if (typeof preset !== "string") return false;
  const range = getPresetRange(preset, new Date());
  if (range === null) return false;
  const [start, end] = range;
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/** 解析用户筛选值："current_user" → currentUserId，否则原样 */
function resolveUserValue(conditionValue: unknown, currentUserId?: string): string | null {
  if (typeof conditionValue !== "string") return null;
  if (conditionValue === "current_user") return currentUserId ?? null;
  return conditionValue;
}

/** 用户匹配：fieldValue 可能是单值或数组（多指派人） */
function matchUser(fieldValue: unknown, conditionValue: unknown, currentUserId?: string): boolean {
  const resolved = resolveUserValue(conditionValue, currentUserId);
  if (resolved === null) return false;
  if (Array.isArray(fieldValue)) {
    return fieldValue.includes(resolved);
  }
  return fieldValue === resolved;
}

/** 单条件匹配 */
function matchCondition(
  record: DatabaseRecord,
  condition: FilterCondition,
  currentUserId?: string,
): boolean {
  const value = getFieldValue(record, condition.fieldId);
  const op = condition.operator;

  switch (op) {
    case "is_empty":
      return isEmptyValue(value);
    case "is_not_empty":
      return !isEmptyValue(value);
    case "equals":
      return strictEquals(value, condition.value);
    case "not_equals":
      return !strictEquals(value, condition.value);
    case "contains":
      return (
        typeof value === "string" &&
        typeof condition.value === "string" &&
        value.toLowerCase().includes(condition.value.toLowerCase())
      );
    case "starts_with":
      return (
        typeof value === "string" &&
        typeof condition.value === "string" &&
        value.toLowerCase().startsWith(condition.value.toLowerCase())
      );
    case "before":
      return compareDates(value, condition.value) < 0;
    case "after":
      return compareDates(value, condition.value) > 0;
    case "within":
      return withinRange(value, condition.value);
    case "is":
      return matchUser(value, condition.value, currentUserId);
    case "is_not":
      return !matchUser(value, condition.value, currentUserId);
    default:
      return false;
  }
}

/** 类型感知值比较（排序用），空值始终排后 */
function compareValues(a: unknown, b: unknown, fieldType: string): number {
  const aEmpty = isEmptyValue(a);
  const bEmpty = isEmptyValue(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  switch (fieldType) {
    case "number": {
      const na = Number(a);
      const nb = Number(b);
      if (isNaN(na) && isNaN(nb)) return 0;
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return sign(na - nb);
    }
    case "date": {
      const da = toDate(a);
      const db = toDate(b);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return sign(da.getTime() - db.getTime());
    }
    case "checkbox": {
      const ba = a === true || a === "true" || a === 1;
      const bb = b === true || b === "true" || b === 1;
      return sign((ba ? 1 : 0) - (bb ? 1 : 0));
    }
    default: {
      // text/select/multiselect/url/email/user: 字符串比较
      // multiselect/user 数组用逗号拼接后比较
      const sa = Array.isArray(a) ? a.join(",") : String(a);
      const sb = Array.isArray(b) ? b.join(",") : String(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    }
  }
}

/** 将字段值转为分组 key 数组（多值字段一条记录可属多个分组） */
function toGroupKeys(value: unknown, fieldType: string): string[] {
  if (isEmptyValue(value)) return [UNGROUPED_KEY];
  if (Array.isArray(value)) {
    // multiselect/user 多值：每个元素一个分组
    const keys = value.map((v) => String(v));
    return keys.length > 0 ? keys : [UNGROUPED_KEY];
  }
  if (typeof value === "boolean") return [value ? "是" : "否"];
  return [String(value)];
}

// ─── 导出函数 ────────────────────────────────────────────────

/**
 * 应用筛选条件。
 * @param records 记录数组
 * @param fields 字段定义（用于过滤掉引用不存在字段的无效条件）
 * @param filters 筛选条件数组
 * @param logic AND=全部满足，OR=任一满足
 * @param currentUserId 可选，用于解析 "current_user" 筛选值
 */
export function applyFilters(
  records: DatabaseRecord[],
  fields: DatabaseField[],
  filters: FilterCondition[],
  logic: "AND" | "OR",
  currentUserId?: string,
): DatabaseRecord[] {
  if (filters.length === 0) return records;
  // 过滤掉引用不存在字段的条件（字段可能已被删除）
  const fieldIds = new Set(fields.map((f) => f.id));
  const validFilters = filters.filter((c) => fieldIds.has(c.fieldId));
  if (validFilters.length === 0) return records;

  return records.filter((record) => {
    const results = validFilters.map((c) => matchCondition(record, c, currentUserId));
    return logic === "AND" ? results.every(Boolean) : results.some(Boolean);
  });
}

/**
 * 应用排序（多字段优先级递减）。
 * 不修改原数组，返回新排序数组。空值始终排后。
 * @param sorts 排序条件数组，顺序即优先级（前面的优先）
 */
export function applySorts(
  records: DatabaseRecord[],
  fields: DatabaseField[],
  sorts: SortCondition[],
): DatabaseRecord[] {
  if (sorts.length === 0) return records;
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  const sorted = [...records];
  sorted.sort((a, b) => {
    for (const sort of sorts) {
      const field = fieldMap.get(sort.fieldId);
      if (!field) continue;
      const av = getFieldValue(a, sort.fieldId);
      const bv = getFieldValue(b, sort.fieldId);
      const cmp = compareValues(av, bv, field.type);
      if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
  return sorted;
}

/**
 * 应用分组。
 * 按 groupFieldId 指定字段的值分组；未设置值的归入 "未分组"。
 * multiselect/user 多值字段：一条记录可属多个分组。
 * 分组顺序：按 key 字母序升序，"未分组" 始终在最后。
 */
export function applyGrouping(
  records: DatabaseRecord[],
  fields: DatabaseField[],
  groupFieldId: string,
): GroupedRecords[] {
  const field = fields.find((f) => f.id === groupFieldId);
  if (!field) return [{ key: ALL_GROUP_KEY, records: [...records] }];

  const groups = new Map<string, DatabaseRecord[]>();
  for (const record of records) {
    const value = getFieldValue(record, groupFieldId);
    const keys = toGroupKeys(value, field.type);
    for (const key of keys) {
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(record);
    }
  }

  const result: GroupedRecords[] = Array.from(groups.entries()).map(([key, recs]) => ({
    key,
    records: recs,
  }));
  // 排序：未分组在最后，其余按 key 字母序升序
  result.sort((a, b) => {
    if (a.key === UNGROUPED_KEY && b.key !== UNGROUPED_KEY) return 1;
    if (b.key === UNGROUPED_KEY && a.key !== UNGROUPED_KEY) return -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return result;
}

/**
 * 主查询函数：对记录数组应用筛选 → 排序 → 分组。
 * 返回分组结果与筛选后总数（total 不含分组，仅筛选后的记录数）。
 */
export function queryRecords(
  records: DatabaseRecord[],
  fields: DatabaseField[],
  options: QueryOptions,
): QueryResult {
  const { filters, filterLogic, sorts, groupFieldId, currentUserId } = options;

  // 1. 筛选
  const filtered =
    filters && filters.length > 0
      ? applyFilters(records, fields, filters, filterLogic ?? "AND", currentUserId)
      : records;

  // 2. 排序
  const sorted = sorts && sorts.length > 0 ? applySorts(filtered, fields, sorts) : filtered;

  // 3. 分组
  const groups = groupFieldId
    ? applyGrouping(sorted, fields, groupFieldId)
    : [{ key: ALL_GROUP_KEY, records: sorted }];

  return { groups, total: filtered.length };
}

/** 从字段 options 中读取 select 选项列表（options 结构：{ options: SelectOption[] }） */
export function getFieldSelectOptions(field: DatabaseField): SelectOption[] {
  if (typeof field.options !== "object" || field.options === null) return [];
  const opts = field.options as { options?: unknown };
  if (!Array.isArray(opts.options)) return [];
  return opts.options as SelectOption[];
}