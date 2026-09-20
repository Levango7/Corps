"use client";

/**
 * 分组控制 · client 交互部分
 *
 * 负责：select onChange、取消分组按钮 onClick
 */

import { Columns, X } from "lucide-react";
import type { DatabaseField } from "@/lib/database/query-engine";

interface GroupControlClientProps {
  groupableFields: DatabaseField[];
  groupFieldId: string | null;
  onChange: (fieldId: string | null) => void;
  label: string;
  fieldAria: string;
  noGroup: string;
  clearAria: string;
}

const selectCls =
  "h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg-2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export function GroupControlClient({
  groupableFields,
  groupFieldId,
  onChange,
  label,
  fieldAria,
  noGroup,
  clearAria,
}: GroupControlClientProps) {
  return (
    <div className="flex items-center gap-2" data-testid="group-control">
      <Columns size={14} className="text-[var(--muted)]" />
      <span className="text-[length:var(--text-sm)] text-[var(--fg-2)] font-[weight:var(--weight-medium)]">
        {label}
      </span>
      <select
        value={groupFieldId ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={selectCls}
        aria-label={fieldAria}
      >
        <option value="">{noGroup}</option>
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
          aria-label={clearAria}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}