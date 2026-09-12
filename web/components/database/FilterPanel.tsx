"use client";

/**
 * 筛选面板 —— 多维表格筛选条件编辑器。
 *
 * 设计：
 *  - 每行一个筛选条件：字段选择 + 操作符选择 + 值输入 + 删除
 *  - 操作符选项根据字段类型动态过滤（如 date 只显示 before/after/within/is_empty/is_not_empty）
 *  - 值输入根据字段类型 + 操作符渲染（text→input, select→dropdown, date→date input, within→预设下拉）
 *  - 顶部 AND/OR 逻辑切换（仅多条件时显示）
 *  - 底部 "添加筛选条件" 按钮
 *  - 所有样式用 design token，lucide-react 图标 size=14
 *
 * 来源：Phase 3D 多维表格筛选/排序/分组
 */

import { Filter, Plus, X } from "lucide-react";
import type {
  DatabaseField,
  FilterCondition,
  FilterOperator,
} from "@/lib/database/query-engine";
import { getFieldSelectOptions } from "@/lib/database/query-engine";

// ─── 操作符映射 ──────────────────────────────────────────────

/** 字段类型 → 可用操作符 */
const OPERATORS_BY_FIELD_TYPE: Record<string, FilterOperator[]> = {
  text: ["contains", "starts_with", "equals", "is_empty", "is_not_empty"],
  url: ["contains", "starts_with", "is_empty", "is_not_empty"],
  email: ["contains", "starts_with", "equals", "is_empty", "is_not_empty"],
  number: ["equals", "not_equals", "is_empty", "is_not_empty"],
  select: ["equals", "not_equals", "is_empty", "is_not_empty"],
  multiselect: ["contains", "is_empty", "is_not_empty"],
  date: ["before", "after", "within", "is_empty", "is_not_empty"],
  checkbox: ["equals", "is_empty", "is_not_empty"],
  user: ["is", "is_not", "is_empty", "is_not_empty"],
};

/** 操作符显示标签 */
const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: "等于",
  not_equals: "不等于",
  contains: "包含",
  starts_with: "开头为",
  is_empty: "为空",
  is_not_empty: "不为空",
  before: "早于",
  after: "晚于",
  within: "属于",
  is: "是",
  is_not: "不是",
};

/** 兜底操作符（字段类型未匹配时） */
const FALLBACK_OPERATORS: FilterOperator[] = ["is_empty"];

/** within 预设选项 */
const WITHIN_PRESETS: { value: string; label: string }[] = [
  { value: "this_week", label: "本周" },
  { value: "this_month", label: "本月" },
  { value: "this_quarter", label: "本季度" },
  { value: "this_year", label: "本年" },
  { value: "last_week", label: "上周" },
  { value: "last_month", label: "上月" },
  { value: "last_year", label: "去年" },
  { value: "last_7_days", label: "过去 7 天" },
  { value: "last_30_days", label: "过去 30 天" },
];

// ─── 样式 ────────────────────────────────────────────────────

const selectCls =
  "h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed";

const inputCls = selectCls;

// ─── 值输入子组件 ────────────────────────────────────────────

interface ValueInputProps {
  field: DatabaseField;
  operator: FilterOperator;
  value: unknown;
  onChange: (v: unknown) => void;
}

/** 根据字段类型 + 操作符渲染对应的值输入控件 */
function ValueInput({ field, operator, value, onChange }: ValueInputProps) {
  // is_empty/is_not_empty 不需要值输入
  if (operator === "is_empty" || operator === "is_not_empty") {
    return null;
  }

  const type = field.type;

  // date + within: 预设范围下拉
  if (type === "date" && operator === "within") {
    return (
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
        aria-label="日期范围"
      >
        <option value="">选择范围</option>
        {WITHIN_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    );
  }

  // date + before/after: 日期输入
  if (type === "date") {
    return (
      <input
        type="date"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
        aria-label="日期"
      />
    );
  }

  // select/multiselect: 选项下拉
  if (type === "select" || type === "multiselect") {
    const options = getFieldSelectOptions(field);
    return (
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
        aria-label="选项"
      >
        <option value="">选择选项</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  // checkbox: 勾选/未勾选
  if (type === "checkbox") {
    return (
      <select
        value={value === true ? "true" : value === false ? "false" : ""}
        onChange={(e) => onChange(e.target.value === "true")}
        className={selectCls}
        aria-label="勾选状态"
      >
        <option value="">选择</option>
        <option value="true">已勾选</option>
        <option value="false">未勾选</option>
      </select>
    );
  }

  // user: 当前用户快捷选择
  if (type === "user") {
    return (
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className={selectCls}
        aria-label="用户"
      >
        <option value="">选择</option>
        <option value="current_user">当前用户</option>
      </select>
    );
  }

  // number: 数字输入
  if (type === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? String(value) : typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={inputCls}
        aria-label="数值"
      />
    );
  }

  // text/url/email: 文本输入
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder="输入值"
      className={inputCls}
      aria-label="文本值"
    />
  );
}

// ─── 主组件 ──────────────────────────────────────────────────

interface FilterPanelProps {
  fields: DatabaseField[];
  filters: FilterCondition[];
  filterLogic: "AND" | "OR";
  onChange: (filters: FilterCondition[], logic: "AND" | "OR") => void;
}

export function FilterPanel({ fields, filters, filterLogic, onChange }: FilterPanelProps) {
  function updateFilter(index: number, patch: Partial<FilterCondition>) {
    const next = filters.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange(next, filterLogic);
  }

  function removeFilter(index: number) {
    onChange(
      filters.filter((_, i) => i !== index),
      filterLogic,
    );
  }

  function addFilter() {
    const firstField = fields[0];
    if (!firstField) return;
    const operators = OPERATORS_BY_FIELD_TYPE[firstField.type] ?? FALLBACK_OPERATORS;
    onChange(
      [...filters, { fieldId: firstField.id, operator: operators[0], value: "" }],
      filterLogic,
    );
  }

  /** 切换字段时，若当前操作符不适用于新字段类型，重置为第一个可用操作符 */
  function changeField(index: number, fieldId: string) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;
    const operators = OPERATORS_BY_FIELD_TYPE[field.type] ?? FALLBACK_OPERATORS;
    const operator = operators.includes(filters[index].operator)
      ? filters[index].operator
      : operators[0];
    updateFilter(index, { fieldId, operator, value: "" });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="filter-panel">
      {/* 标题 + 逻辑切换 */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-[var(--muted)]" />
        <span className="text-[length:var(--text-sm)] text-[var(--fg-2)] font-[weight:var(--weight-medium)]">
          筛选
        </span>
        {filters.length > 1 && (
          <div className="flex items-center gap-1 ms-1">
            <button
              onClick={() => onChange(filters, "AND")}
              className={`h-6 px-2 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] ${
                filterLogic === "AND"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)]"
              }`}
              aria-pressed={filterLogic === "AND"}
            >
              且
            </button>
            <button
              onClick={() => onChange(filters, "OR")}
              className={`h-6 px-2 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] ${
                filterLogic === "OR"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)]"
              }`}
              aria-pressed={filterLogic === "OR"}
            >
              或
            </button>
          </div>
        )}
      </div>

      {/* 筛选条件列表 */}
      {filters.map((filter, i) => {
        const field = fields.find((f) => f.id === filter.fieldId);
        const operators = field
          ? (OPERATORS_BY_FIELD_TYPE[field.type] ?? FALLBACK_OPERATORS)
          : FALLBACK_OPERATORS;
        return (
          <div key={i} className="flex items-center gap-2">
            {/* 字段选择 */}
            <select
              value={filter.fieldId}
              onChange={(e) => changeField(i, e.target.value)}
              className={selectCls}
              aria-label="筛选字段"
            >
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {/* 操作符选择 */}
            <select
              value={filter.operator}
              onChange={(e) => updateFilter(i, { operator: e.target.value as FilterOperator })}
              className={selectCls}
              aria-label="操作符"
            >
              {operators.map((op) => (
                <option key={op} value={op}>
                  {OPERATOR_LABELS[op]}
                </option>
              ))}
            </select>
            {/* 值输入 */}
            {field && (
              <ValueInput
                field={field}
                operator={filter.operator}
                value={filter.value}
                onChange={(v) => updateFilter(i, { value: v })}
              />
            )}
            {/* 删除 */}
            <button
              onClick={() => removeFilter(i)}
              className="flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              aria-label="删除筛选条件"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}

      {/* 添加筛选条件 */}
      <button
        onClick={addFilter}
        disabled={fields.length === 0}
        className="flex items-center gap-1 h-8 px-2 w-fit rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus size={14} />
        添加筛选条件
      </button>
    </div>
  );
}