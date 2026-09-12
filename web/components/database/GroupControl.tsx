"use client";

/**
 * 分组控制 —— 多维表格分组字段选择器。
 *
 * 设计：
 *  - 下拉选择分组字段（只允许 select/multiselect/user 类型字段）
 *  - "不分组" 选项（value=""）
 *  - 选中分组字段后显示 "取消分组" 按钮
 *  - 所有样式用 design token，lucide-react 图标 size=14
 *
 * 来源：Phase 3D 多维表格筛选/排序/分组
 */

import { Columns, X } from "lucide-react";
import type { DatabaseField } from "@/lib/database/query-engine";
import { useTranslations } from "next-intl";

// ─── 可分组字段类型 ──────────────────────────────────────────

const GROUPABLE_TYPES = new Set(["select", "multiselect", "user"]);

// ─── 样式 ────────────────────────────────────────────────────

const selectCls =
  "h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

// ─── 主组件 ──────────────────────────────────────────────────

interface GroupControlProps {
  fields: DatabaseField[];
  groupFieldId: string | null;
  onChange: (fieldId: string | null) => void;
}

export function GroupControl({ fields, groupFieldId, onChange }: GroupControlProps) {
  const t = useTranslations("database.groupControl");

  // 只允许 select/multiselect/user 类型字段分组
  const groupableFields = fields.filter((f) => GROUPABLE_TYPES.has(f.type));

  return (
    <div className="flex items-center gap-2" data-testid="group-control">
      <Columns size={14} className="text-[var(--muted)]" />
      <span className="text-[length:var(--text-sm)] text-[var(--fg-2)] font-[weight:var(--weight-medium)]">
        {t("label")}
      </span>
      <select
        value={groupFieldId ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={selectCls}
        aria-label={t("fieldAria")}
      >
        <option value="">{t("noGroup")}</option>
        {groupableFields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      {/* 取消分组按钮 */}
      {groupFieldId && (
        <button
          onClick={() => onChange(null)}
          className="flex items-center justify-center h-8 w-8 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          aria-label={t("clearAria")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}