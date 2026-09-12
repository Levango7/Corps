"use client";

import type { DatabaseField } from "@prisma/client";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Check, ChevronDown, X, Plus, ExternalLink } from "lucide-react";

// ─── 字段类型定义 ───────────────────────────────────────────────────────────
/** 多维表格字段类型（12 种） */
export type FieldType =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "checkbox"
  | "user"
  | "url"
  | "email"
  | "formula"
  | "relation"
  | "rollup";

/** select/multiselect 选项 */
export interface FieldChoice {
  id: string;
  label: string;
  /** 颜色 token 名，留空则循环分配 */
  color?: "accent" | "success" | "warn" | "danger";
}

/** 字段选项（解析自 DatabaseField.options JSON） */
export interface FieldOptions {
  choices?: FieldChoice[];
  /** date: 是否支持范围 */
  range?: boolean;
  /** formula: 表达式 */
  expression?: string;
  /** relation: 关联数据库 ID */
  databaseId?: string;
  /** rollup: 聚合函数 */
  fn?: "sum" | "avg" | "min" | "max" | "count";
}

/** 日期范围值 */
export interface DateRange {
  start: string;
  end?: string;
}

/** FieldControl 公共 props */
export interface FieldControlProps {
  field: DatabaseField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}

// ─── 工具函数 ───────────────────────────────────────────────────────────────
/** 选项颜色循环池 */
const COLOR_POOL: FieldChoice["color"][] = ["accent", "success", "warn", "danger"];

/** 将颜色名映射为 CSS 变量（实色） */
function choiceColorVar(color: FieldChoice["color"], index: number): string {
  const c = color ?? COLOR_POOL[index % COLOR_POOL.length];
  switch (c) {
    case "success":
      return "var(--success)";
    case "warn":
      return "var(--warn)";
    case "danger":
      return "var(--danger)";
    default:
      return "var(--accent)";
  }
}

/** 将颜色名映射为 CSS 变量（soft 背景） */
function choiceColorSoftVar(color: FieldChoice["color"], index: number): string {
  const c = color ?? COLOR_POOL[index % COLOR_POOL.length];
  switch (c) {
    case "success":
      return "var(--success-soft)";
    case "warn":
      return "var(--warn-soft)";
    case "danger":
      return "var(--danger-soft)";
    default:
      return "var(--accent-soft)";
  }
}

/** 安全解析 field.options JSON 为 FieldOptions */
export function parseFieldOptions(options: unknown): FieldOptions {
  if (!options || typeof options !== "object") return {};
  const raw = options as Record<string, unknown>;
  const parsed: FieldOptions = {};
  if (Array.isArray(raw.choices)) {
    parsed.choices = raw.choices
      .filter(
        (c): c is Record<string, unknown> =>
          typeof c === "object" && c !== null,
      )
      .filter(
        (c) => typeof c.id === "string" && typeof c.label === "string",
      )
      .map((c, i) => {
        const choice: FieldChoice = {
          id: c.id as string,
          label: c.label as string,
        };
        const color = c.color;
        if (
          color === "accent" ||
          color === "success" ||
          color === "warn" ||
          color === "danger"
        ) {
          choice.color = color;
        } else {
          choice.color = COLOR_POOL[i % COLOR_POOL.length];
        }
        return choice;
      });
  }
  if (typeof raw.range === "boolean") parsed.range = raw.range;
  if (typeof raw.expression === "string") parsed.expression = raw.expression;
  if (typeof raw.databaseId === "string") parsed.databaseId = raw.databaseId;
  if (typeof raw.fn === "string") {
    const fn = raw.fn;
    if (fn === "sum" || fn === "avg" || fn === "min" || fn === "max" || fn === "count") {
      parsed.fn = fn;
    }
  }
  return parsed;
}

/** 将单元格值格式化为显示字符串（供只读预览） */
export function formatCellValue(field: DatabaseField, value: unknown): string {
  if (value === null || value === undefined) return "";
  const opts = parseFieldOptions(field.options);
  switch (field.type as FieldType) {
    case "text":
    case "url":
    case "email":
    case "user":
      return typeof value === "string" ? value : String(value);
    case "number":
      return typeof value === "number" ? String(value) : "";
    case "checkbox":
      return value === true ? "✓" : "";
    case "select": {
      if (typeof value !== "string") return "";
      const choice = opts.choices?.find((c) => c.id === value);
      return choice ? choice.label : "";
    }
    case "multiselect": {
      if (!Array.isArray(value)) return "";
      const ids = value.filter((v): v is string => typeof v === "string");
      const labels = ids
        .map((id) => opts.choices?.find((c) => c.id === id)?.label ?? id)
        .filter(Boolean);
      return labels.join(", ");
    }
    case "date": {
      if (typeof value === "string") return value;
      if (typeof value === "object" && value !== null) {
        const range = value as Partial<DateRange>;
        if (typeof range.start === "string") {
          return range.end ? `${range.start} ~ ${range.end}` : range.start;
        }
      }
      return "";
    }
    case "formula":
    case "rollup":
      return typeof value === "string" ? value : value != null ? String(value) : "";
    case "relation": {
      if (!Array.isArray(value)) return "";
      const ids = value.filter((v): v is string => typeof v === "string");
      return `${ids.length} 条关联`;
    }
    default:
      return "";
  }
}

// ─── 共享样式 ───────────────────────────────────────────────────────────────
const inputClass =
  "w-full h-full bg-transparent border-0 outline-none px-2 text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] focus:outline-none";

const readonlyClass =
  "w-full h-full flex items-center px-2 text-[length:var(--text-sm)] text-[var(--fg-2)] truncate";

const emptyClass =
  "w-full h-full flex items-center px-2 text-[length:var(--text-sm)] text-[var(--meta)]";

// ─── 点击外部关闭 Hook ──────────────────────────────────────────────────────
function useClickOutside<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);
  return ref;
}

// ─── 1. text ────────────────────────────────────────────────────────────────
function TextControl({ value, onChange, readOnly }: FieldControlProps): ReactElement {
  const str = typeof value === "string" ? value : "";
  if (readOnly) {
    return (
      <div className={str ? readonlyClass : emptyClass}>
        {str || "空"}
      </div>
    );
  }
  return (
    <input
      type="text"
      className={inputClass}
      value={str}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─── 2. number ──────────────────────────────────────────────────────────────
function NumberControl({ value, onChange, readOnly }: FieldControlProps): ReactElement {
  const num = typeof value === "number" ? value : null;
  if (readOnly) {
    return (
      <div className={num !== null ? readonlyClass : emptyClass}>
        {num !== null ? String(num) : "空"}
      </div>
    );
  }
  return (
    <input
      type="number"
      className={inputClass}
      value={num ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : Number(v));
      }}
    />
  );
}

// ─── 3. select ──────────────────────────────────────────────────────────────
function SelectControl({ field, value, onChange, readOnly }: FieldControlProps): ReactElement {
  const opts = parseFieldOptions(field.options);
  const choices = opts.choices ?? [];
  const selectedId = typeof value === "string" ? value : "";
  const selected = choices.find((c) => c.id === selectedId);
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  if (readOnly) {
    if (!selected) return <div className={emptyClass}>空</div>;
    const idx = choices.indexOf(selected);
    return (
      <div className="w-full h-full flex items-center gap-1.5 px-2 text-[length:var(--text-sm)]">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: choiceColorVar(selected.color, idx) }}
        />
        <span className="truncate text-[var(--fg)]">{selected.label}</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative w-full h-full">
      <button
        type="button"
        className="w-full h-full flex items-center gap-1.5 px-2 text-[length:var(--text-sm)] text-left hover:bg-[var(--surface-2)]"
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                background: choiceColorVar(selected.color, choices.indexOf(selected)),
              }}
            />
            <span className="truncate text-[var(--fg)]">{selected.label}</span>
          </>
        ) : (
          <span className="text-[var(--meta)]">选择...</span>
        )}
        <ChevronDown size={14} className="ml-auto shrink-0 text-[var(--meta)]" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-[var(--elev-md)] py-1 max-h-48 overflow-auto z-[var(--z-dropdown)]">
          {choices.length === 0 ? (
            <div className="px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--meta)]">
              无选项
            </div>
          ) : (
            choices.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[length:var(--text-sm)] text-left hover:bg-[var(--surface-2)] text-[var(--fg)]"
                onClick={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: choiceColorVar(c.color, i) }}
                />
                <span className="truncate">{c.label}</span>
                {c.id === selectedId && (
                  <Check size={14} className="ml-auto shrink-0 text-[var(--accent)]" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── 4. multiselect ─────────────────────────────────────────────────────────
function MultiSelectControl({
  field,
  value,
  onChange,
  readOnly,
}: FieldControlProps): ReactElement {
  const opts = parseFieldOptions(field.options);
  const choices = opts.choices ?? [];
  const selectedIds: string[] = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  const remove = (id: string) => {
    onChange(selectedIds.filter((v) => v !== id));
  };
  const add = (id: string) => {
    if (!selectedIds.includes(id)) {
      onChange([...selectedIds, id]);
    }
  };

  const renderTag = (id: string, editable: boolean) => {
    const choice = choices.find((c) => c.id === id);
    const idx = choice ? choices.indexOf(choice) : 0;
    const label = choice?.label ?? id;
    return (
      <span
        key={id}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] shrink-0"
        style={{
          background: choiceColorSoftVar(choice?.color, idx),
          color: choiceColorVar(choice?.color, idx),
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: choiceColorVar(choice?.color, idx) }}
        />
        {label}
        {editable && (
          <button
            type="button"
            className="shrink-0 opacity-60 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              remove(id);
            }}
          >
            <X size={12} />
          </button>
        )}
      </span>
    );
  };

  if (readOnly) {
    if (selectedIds.length === 0) return <div className={emptyClass}>空</div>;
    return (
      <div className="w-full h-full flex items-center gap-1 px-2 overflow-hidden">
        {selectedIds.map((id) => renderTag(id, false))}
      </div>
    );
  }

  const unselected = choices.filter((c) => !selectedIds.includes(c.id));

  return (
    <div ref={ref} className="relative w-full h-full">
      <button
        type="button"
        className="w-full h-full flex items-center gap-1 px-2 text-left flex-wrap content-center"
        onClick={() => setOpen((v) => !v)}
      >
        {selectedIds.length === 0 ? (
          <span className="text-[length:var(--text-sm)] text-[var(--meta)]">
            选择...
          </span>
        ) : (
          selectedIds.map((id) => renderTag(id, true))
        )}
        <ChevronDown size={14} className="ml-auto shrink-0 text-[var(--meta)]" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-[var(--elev-md)] py-1 max-h-48 overflow-auto z-[var(--z-dropdown)]">
          {unselected.length === 0 ? (
            <div className="px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--meta)]">
              无可选项
            </div>
          ) : (
            unselected.map((c) => {
              const idx = choices.indexOf(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[length:var(--text-sm)] text-left hover:bg-[var(--surface-2)] text-[var(--fg)]"
                  onClick={() => add(c.id)}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: choiceColorVar(c.color, idx) }}
                  />
                  <span className="truncate">{c.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── 5. date ────────────────────────────────────────────────────────────────
function DateControl({ field, value, onChange, readOnly }: FieldControlProps): ReactElement {
  const opts = parseFieldOptions(field.options);
  const isRange = opts.range === true;

  // 解析值
  let start = "";
  let end = "";
  if (typeof value === "string") {
    start = value;
  } else if (typeof value === "object" && value !== null) {
    const range = value as Partial<DateRange>;
    if (typeof range.start === "string") start = range.start;
    if (typeof range.end === "string") end = range.end;
  }

  if (readOnly) {
    const text = end ? `${start} ~ ${end}` : start;
    return <div className={text ? readonlyClass : emptyClass}>{text || "空"}</div>;
  }

  if (isRange) {
    return (
      <div className="w-full h-full flex items-center gap-1 px-2">
        <input
          type="date"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[length:var(--text-sm)] text-[var(--fg)]"
          value={start}
          onChange={(e) =>
            onChange({ start: e.target.value, end: end || undefined })
          }
        />
        <span className="text-[var(--meta)] text-[length:var(--text-sm)]">~</span>
        <input
          type="date"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[length:var(--text-sm)] text-[var(--fg)]"
          value={end}
          onChange={(e) =>
            onChange({
              start,
              end: e.target.value || undefined,
            })
          }
        />
      </div>
    );
  }

  return (
    <input
      type="date"
      className={inputClass}
      value={start}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─── 6. checkbox ────────────────────────────────────────────────────────────
function CheckboxControl({ value, onChange, readOnly }: FieldControlProps): ReactElement {
  const checked = value === true;
  return (
    <div className="w-full h-full flex items-center justify-center">
      <input
        type="checkbox"
        className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
        checked={checked}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

// ─── 7. user ────────────────────────────────────────────────────────────────
function UserControl({ value, onChange, readOnly }: FieldControlProps): ReactElement {
  const userId = typeof value === "string" ? value : "";
  if (readOnly) {
    return (
      <div className={userId ? readonlyClass : emptyClass}>{userId || "空"}</div>
    );
  }
  return (
    <input
      type="text"
      className={inputClass}
      value={userId}
      placeholder="用户 ID"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─── 8. url ─────────────────────────────────────────────────────────────────
function UrlControl({ value, onChange, readOnly }: FieldControlProps): ReactElement {
  const url = typeof value === "string" ? value : "";
  if (readOnly) {
    if (!url) return <div className={emptyClass}>空</div>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-full h-full flex items-center gap-1 px-2 text-[length:var(--text-sm)] text-[var(--accent)] truncate hover:underline"
      >
        <ExternalLink size={14} className="shrink-0" />
        <span className="truncate">{url}</span>
      </a>
    );
  }
  return (
    <input
      type="url"
      className={inputClass}
      value={url}
      placeholder="https://"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─── 9. email ───────────────────────────────────────────────────────────────
function EmailControl({ value, onChange, readOnly }: FieldControlProps): ReactElement {
  const email = typeof value === "string" ? value : "";
  if (readOnly) {
    return (
      <div className={email ? readonlyClass : emptyClass}>{email || "空"}</div>
    );
  }
  return (
    <input
      type="email"
      className={inputClass}
      value={email}
      placeholder="example@domain.com"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ─── 10. formula（只读） ────────────────────────────────────────────────────
function FormulaControl({ value }: FieldControlProps): ReactElement {
  const text =
    typeof value === "string"
      ? value
      : value !== null && value !== undefined
        ? String(value)
        : "";
  return (
    <div className={text ? readonlyClass : emptyClass}>
      {text || "—"}
    </div>
  );
}

// ─── 11. relation ───────────────────────────────────────────────────────────
function RelationControl({ value, onChange, readOnly }: FieldControlProps): ReactElement {
  const ids: string[] = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
  const [text, setText] = useState(ids.join(", "));

  // 同步外部值变更
  useEffect(() => {
    setText(ids.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(ids)]);

  if (readOnly) {
    if (ids.length === 0) return <div className={emptyClass}>空</div>;
    return (
      <div className="w-full h-full flex items-center px-2 text-[length:var(--text-sm)] text-[var(--fg-2)] truncate">
        {ids.length} 条关联
      </div>
    );
  }

  return (
    <input
      type="text"
      className={inputClass}
      value={text}
      placeholder="记录 ID（逗号分隔）"
      onChange={(e) => {
        setText(e.target.value);
        const newIds = e.target.value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        onChange(newIds);
      }}
    />
  );
}

// ─── 12. rollup（只读） ─────────────────────────────────────────────────────
function RollupControl({ value }: FieldControlProps): ReactElement {
  const text =
    typeof value === "string"
      ? value
      : value !== null && value !== undefined
        ? String(value)
        : "";
  return (
    <div className={text ? readonlyClass : emptyClass}>
      {text || "—"}
    </div>
  );
}

// ─── 分发器 ─────────────────────────────────────────────────────────────────
/**
 * 字段编辑控件分发器。
 * 根据 field.type 渲染对应的编辑控件，统一处理 12 种字段类型。
 */
export function FieldControl({
  field,
  value,
  onChange,
  readOnly,
}: FieldControlProps): ReactElement {
  const props: FieldControlProps = { field, value, onChange, readOnly };
  switch (field.type as FieldType) {
    case "text":
      return <TextControl {...props} />;
    case "number":
      return <NumberControl {...props} />;
    case "select":
      return <SelectControl {...props} />;
    case "multiselect":
      return <MultiSelectControl {...props} />;
    case "date":
      return <DateControl {...props} />;
    case "checkbox":
      return <CheckboxControl {...props} />;
    case "user":
      return <UserControl {...props} />;
    case "url":
      return <UrlControl {...props} />;
    case "email":
      return <EmailControl {...props} />;
    case "formula":
      return <FormulaControl {...props} />;
    case "relation":
      return <RelationControl {...props} />;
    case "rollup":
      return <RollupControl {...props} />;
    default:
      // 未知类型降级为文本
      return <TextControl {...props} />;
  }
}

/** 导出 Plus 图标供 TableView 使用 */
export { Plus as PlusIcon };