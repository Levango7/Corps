"use client";

/**
 * F3 Widget 仪表盘 — 「添加 Widget」选择对话框。
 *
 * 设计依据：design/FEATURE-DESIGN-v0.7.md §3.6。
 *
 * 职责：
 *  - 显示可用 Widget 列表（从 WIDGET_REGISTRY 获取，排除已添加的）
 *  - 点击 Widget 项触发 onAdd(widgetId)，由父组件追加到布局
 *  - 使用 design token 样式，图标来自 lucide-react
 *
 * 交互：
 *  - ESC 关闭 / 点击遮罩关闭
 *  - 已添加的 Widget 项灰显并标记「已添加」
 */

import { useEffect, useRef } from "react";
import { X, Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { WIDGET_REGISTRY, WIDGET_IDS } from "./default-layouts";
import { getWidgetIcon } from "./widgets";

export interface AddWidgetDialogProps {
  /** 是否打开 */
  open: boolean;
  /** 已添加的 Widget id 列表（用于灰显已添加项） */
  addedIds: string[];
  /** 添加 Widget 回调 */
  onAdd: (widgetId: string) => void;
  /** 关闭回调 */
  onClose: () => void;
}

export default function AddWidgetDialog({
  open,
  addedIds,
  onAdd,
  onClose,
}: AddWidgetDialogProps) {
  const t = useTranslations("dashboard");
  const dialogRef = useRef<HTMLDivElement>(null);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 打开时聚焦对话框
  useEffect(() => {
    if (open && dialogRef.current) {
      const id = requestAnimationFrame(() => dialogRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  if (!open) return null;

  const addedSet = new Set(addedIds);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("addWidgetTitle")}
        tabIndex={-1}
        className="w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)] focus-visible:outline-none"
      >
        {/* 标题栏 */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("addWidgetTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("close")}
          >
            <X size={16} />
          </button>
        </header>

        {/* Widget 列表 */}
        <div className="p-3 max-h-[60vh] overflow-auto">
          <ul className="space-y-1">
            {WIDGET_IDS.map((id) => {
              const meta = WIDGET_REGISTRY[id];
              const Icon = getWidgetIcon(id);
              const added = addedSet.has(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    disabled={added}
                    onClick={() => {
                      onAdd(id);
                      onClose();
                    }}
                    className={[
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] text-left transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
                      added
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-[var(--surface-2)] cursor-pointer",
                    ].join(" ")}
                  >
                    <span className="shrink-0 w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--surface-2)] flex items-center justify-center text-[var(--fg-2)]">
                      <Icon size={16} strokeWidth={2} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                        {t(meta.titleKey)}
                      </span>
                      <span className="block text-[length:var(--text-xs)] text-[var(--meta)] truncate">
                        {t(`${meta.titleKey}Desc`)}
                      </span>
                    </span>
                    {added ? (
                      <Check size={14} className="shrink-0 text-[var(--meta)]" />
                    ) : (
                      <Plus size={14} className="shrink-0 text-[var(--muted)]" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}