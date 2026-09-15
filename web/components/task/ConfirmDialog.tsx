"use client";

// 自定义确认弹窗（替代 window.confirm）。
// 拆分自 task/[id]/page.tsx 第 1167-1210 行，纯展示 + 回调。

import { Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
  taskTitle: string;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  deleting,
  taskTitle,
}: ConfirmDialogProps) {
  const t = useTranslations("task");
  const tButton = useTranslations("button");

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("confirmAria")}
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-[var(--space-4)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] p-[var(--space-5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-2)]">
          {t("confirmDeleteTitle")}
        </h3>
        <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[var(--leading-relaxed)] mb-[var(--space-5)]">
          {t("confirmDeleteTask", { title: taskTitle })}
        </p>
        <div className="flex items-center justify-end gap-[var(--space-2)]">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            {tButton("cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] bg-[var(--danger)] text-[var(--accent-fg)] hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            {deleting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            {t("confirmDelete")}
          </button>
        </div>
      </div>
    </div>
  );
}