"use client";

import type { Label } from "@/lib/types";

/**
 * 任务标签展示（P4：看板标签/里程碑）
 *
 * 在任务卡片上以小色块 + 名称形式展示标签。
 * 最多展示 3 个，超出显示 "+N"。
 */
export function TaskLabels({ labels, max = 3 }: { labels: Label[]; max?: number }) {
  if (!labels || labels.length === 0) return null;

  const visible = labels.slice(0, max);
  const overflow = labels.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {visible.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[length:var(--text-xs)] font-[var(--weight-medium)]"
          style={{
            background: `color-mix(in srgb, ${label.color} 14%, transparent)`,
            color: label.color,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: label.color }}
            aria-hidden="true"
          />
          {label.name}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-[length:var(--text-xs)] text-[var(--meta)] px-1">+{overflow}</span>
      )}
    </div>
  );
}
