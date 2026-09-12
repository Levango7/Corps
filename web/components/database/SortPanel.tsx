"use client";

/**
 * 排序面板 —— 多维表格排序条件编辑器。
 *
 * 设计：
 *  - 每行一个排序条件：序号 + 字段选择 + 升降序切换 + 上移/下移 + 删除
 *  - 多字段排序，sorts 数组顺序即优先级（序号 1 优先级最高）
 *  - 上移/下移按钮调整优先级（简化方案，替代拖拽）
 *  - 底部 "添加排序" 按钮
 *  - 所有样式用 design token，lucide-react 图标 size=14
 *
 * 来源：Phase 3D 多维表格筛选/排序/分组
 */

import { ArrowDown, ArrowUp, ChevronsUpDown, Plus, X } from "lucide-react";
import type { DatabaseField, SortCondition } from "@/lib/database/query-engine";
import { useTranslations } from "next-intl";

// ─── 样式 ────────────────────────────────────────────────────

const selectCls =
  "h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed";

// ─── 主组件 ──────────────────────────────────────────────────

interface SortPanelProps {
  fields: DatabaseField[];
  sorts: SortCondition[];
  onChange: (sorts: SortCondition[]) => void;
}

export function SortPanel({ fields, sorts, onChange }: SortPanelProps) {
  const t = useTranslations("database.sortPanel");

  function updateSort(index: number, patch: Partial<SortCondition>) {
    onChange(sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSort(index: number) {
    onChange(sorts.filter((_, i) => i !== index));
  }

  function addSort() {
    const firstField = fields[0];
    if (!firstField) return;
    onChange([...sorts, { fieldId: firstField.id, direction: "asc" }]);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...sorts];
    const tmp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = tmp;
    onChange(next);
  }

  function moveDown(index: number) {
    if (index === sorts.length - 1) return;
    const next = [...sorts];
    const tmp = next[index];
    next[index] = next[index + 1];
    next[index + 1] = tmp;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="sort-panel">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <ChevronsUpDown size={14} className="text-[var(--muted)]" />
        <span className="text-[length:var(--text-sm)] text-[var(--fg-2)] font-[weight:var(--weight-medium)]">
          {t("title")}
        </span>
      </div>

      {/* 排序条件列表 */}
      {sorts.map((sort, i) => (
        <div key={i} className="flex items-center gap-2">
          {/* 优先级序号 */}
          <span className="text-[length:var(--text-xs)] text-[var(--meta)] w-4 text-center shrink-0">
            {i + 1}
          </span>
          {/* 字段选择 */}
          <select
            value={sort.fieldId}
            onChange={(e) => updateSort(i, { fieldId: e.target.value })}
            className={selectCls}
            aria-label={t("fieldAria")}
          >
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {/* 升降序切换 */}
          <button
            onClick={() =>
              updateSort(i, { direction: sort.direction === "asc" ? "desc" : "asc" })
            }
            className="flex items-center gap-1 h-8 px-2 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label={sort.direction === "asc" ? t("ascAria") : t("descAria")}
          >
            {sort.direction === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            {sort.direction === "asc" ? t("asc") : t("desc")}
          </button>
          {/* 上移 */}
          <button
            onClick={() => moveUp(i)}
            disabled={i === 0}
            className="flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={t("moveUpAria")}
          >
            <ArrowUp size={14} />
          </button>
          {/* 下移 */}
          <button
            onClick={() => moveDown(i)}
            disabled={i === sorts.length - 1}
            className="flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={t("moveDownAria")}
          >
            <ArrowDown size={14} />
          </button>
          {/* 删除 */}
          <button
            onClick={() => removeSort(i)}
            className="flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label={t("removeAria")}
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {/* 添加排序 */}
      <button
        onClick={addSort}
        disabled={fields.length === 0}
        className="flex items-center gap-1 h-8 px-2 w-fit rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--accent)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Plus size={14} />
        {t("addSort")}
      </button>
    </div>
  );
}