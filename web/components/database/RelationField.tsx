"use client";

/**
 * 关联记录选择 UI（relation 字段编辑控件）
 *
 * ## 功能
 *
 * - 显示已关联记录列表，每条记录渲染为 chip（标签）
 * - 每个 chip 显示 displayField 的值，点击 X 可移除（非 readOnly 时）
 * - 底部 "+ 添加关联" 按钮，点击展开搜索面板
 * - 搜索面板可输入文字过滤目标记录，点击记录添加关联
 * - readOnly 模式下仅展示 chip，无移除/添加按钮
 *
 * ## 样式
 *
 * - 所有颜色/间距/圆角使用 design token（var(--*)），禁止裸 hex
 * - lucide-react 图标尺寸统一 14
 * - "use client" 隔离客户端交互
 */

import type { DatabaseField, DatabaseRecord } from "@prisma/client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Link2, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";

// ─── Props ──────────────────────────────────────────────────

export interface RelationFieldProps {
  /** relation 类型字段 */
  field: DatabaseField;
  /** 当前值（record ID 数组） */
  value: unknown;
  /** 已解析的关联记录（目标 Database 中的记录列表） */
  relatedRecords: DatabaseRecord[];
  /** 目标 Database 的字段列表（用于确定 displayField） */
  targetFields: DatabaseField[];
  /** 值变更回调 */
  onChange?: (value: string[]) => void;
  /** 只读模式 */
  readOnly?: boolean;
}

// ─── 内部工具 ───────────────────────────────────────────────

/**
 * 安全读取 DatabaseRecord.data 中某个字段的值并转为显示字符串。
 * data 是 Prisma JsonValue，仅当为非数组 object 时按字段键读取。
 */
function readFieldDisplayValue(
  record: DatabaseRecord,
  fieldId: string,
): string {
  const data = record.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "";
  }
  const v = (data as Record<string, unknown>)[fieldId];
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/**
 * 从 field.options 解析 displayFieldId。
 * 若未配置，回退到目标字段列表中第一个 text 类型字段的 ID。
 */
function resolveDisplayFieldId(
  field: DatabaseField,
  targetFields: DatabaseField[],
): string | undefined {
  const opts = field.options;
  if (
    typeof opts === "object" &&
    opts !== null &&
    !Array.isArray(opts)
  ) {
    const raw = opts as Record<string, unknown>;
    if (typeof raw.displayFieldId === "string") {
      return raw.displayFieldId;
    }
  }
  // 回退：第一个 text 字段
  const firstText = targetFields.find((f) => f.type === "text");
  return firstText?.id;
}

// ─── 共享样式 ───────────────────────────────────────────────

const chipBaseClass =
  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] shrink-0";

const emptyClass =
  "w-full h-full flex items-center px-2 text-[length:var(--text-sm)] text-[var(--meta)]";

// ─── 组件 ───────────────────────────────────────────────────

export function RelationField({
  field,
  value,
  relatedRecords,
  targetFields,
  onChange,
  readOnly,
}: RelationFieldProps): ReactElement {
  const t = useTranslations("database.relationField");

  // 规范化当前值为 string[]
  const ids: string[] = useMemo(
    () =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [],
    [value],
  );

  // 确定 displayFieldId
  const displayFieldId = useMemo(
    () => resolveDisplayFieldId(field, targetFields),
    [field, targetFields],
  );

  // 搜索面板状态
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭搜索面板
  useEffect(() => {
    if (!searchOpen) return;
    function handleMouseDown(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [searchOpen]);

  // 已关联记录查找映射
  const relatedMap = useMemo(() => {
    const m = new Map<string, DatabaseRecord>();
    for (const r of relatedRecords) m.set(r.id, r);
    return m;
  }, [relatedRecords]);

  // 搜索过滤结果（排除已选）
  const filteredRecords = useMemo(() => {
    if (!searchOpen) return [];
    const q = query.trim().toLowerCase();
    return relatedRecords.filter((r) => {
      if (ids.includes(r.id)) return false;
      if (q === "") return true;
      const label = displayFieldId
        ? readFieldDisplayValue(r, displayFieldId)
        : r.id;
      return label.toLowerCase().includes(q);
    });
  }, [searchOpen, query, relatedRecords, ids, displayFieldId]);

  // 移除关联
  const removeRelation = (id: string): void => {
    if (!onChange) return;
    onChange(ids.filter((v) => v !== id));
  };

  // 添加关联
  const addRelation = (id: string): void => {
    if (!onChange) return;
    if (!ids.includes(id)) {
      onChange([...ids, id]);
    }
  };

  // 渲染 chip
  const renderChip = (id: string, editable: boolean): ReactElement => {
    const record = relatedMap.get(id);
    const label =
      record && displayFieldId
        ? readFieldDisplayValue(record, displayFieldId)
        : id;
    return (
      <span
        key={id}
        className={chipBaseClass}
        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
      >
        <Link2 size={14} className="shrink-0" />
        <span className="truncate max-w-[120px]">{label || id}</span>
        {editable && (
          <button
            type="button"
            className="shrink-0 opacity-60 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              removeRelation(id);
            }}
            aria-label={t("removeRelationAria")}
          >
            <X size={14} />
          </button>
        )}
      </span>
    );
  };

  // ─── 只读模式 ─────────────────────────────────────────────
  if (readOnly) {
    if (ids.length === 0) {
      return <div className={emptyClass}>{t("empty")}</div>;
    }
    return (
      <div className="w-full h-full flex items-center gap-1 px-2 overflow-hidden flex-wrap content-center">
        {ids.map((id) => renderChip(id, false))}
      </div>
    );
  }

  // ─── 编辑模式 ─────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative w-full h-full">
      <div className="w-full h-full flex items-center gap-1 px-2 flex-wrap content-center">
        {ids.length === 0 && !searchOpen && (
          <span className="text-[length:var(--text-sm)] text-[var(--meta)]">
            {t("noRelation")}
          </span>
        )}
        {ids.map((id) => renderChip(id, true))}
        <button
          type="button"
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] shrink-0"
          onClick={() => setSearchOpen((v) => !v)}
          aria-label={t("addRelationAria")}
        >
          <Plus size={14} />
          <span>{t("addRelation")}</span>
        </button>
      </div>

      {searchOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-[var(--elev-md)] z-[var(--z-dropdown)]">
          {/* 搜索输入框 */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--border)]">
            <Search size={14} className="shrink-0 text-[var(--meta)]" />
            <input
              type="text"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)]"
              placeholder={t("searchPlaceholder")}
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* 搜索结果列表 */}
          <div className="max-h-48 overflow-auto py-1">
            {filteredRecords.length === 0 ? (
              <div className="px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--meta)]">
                {t("noMatch")}
              </div>
            ) : (
              filteredRecords.map((r) => {
                const label = displayFieldId
                  ? readFieldDisplayValue(r, displayFieldId)
                  : r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[length:var(--text-sm)] text-left hover:bg-[var(--surface-2)] text-[var(--fg)]"
                    onClick={() => {
                      addRelation(r.id);
                      setQuery("");
                    }}
                  >
                    <Link2 size={14} className="shrink-0 text-[var(--meta)]" />
                    <span className="truncate">{label || r.id}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}