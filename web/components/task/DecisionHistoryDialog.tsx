"use client";

// 决策版本历史弹窗。
// 拆分自 task/[id]/page.tsx 第 1107-1164 行。
// < sm：全屏弹窗（底部贴边、无圆角、100dvh）
// ≥ sm：居中弹窗（max-w-lg、80dvh、圆角）

import { useEffect, useRef } from "react";
import { History, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Markdown from "@/components/Markdown";
import type { Decision, DecisionVersion } from "./types";

interface DecisionHistoryDialogProps {
  historyFor: Decision | null;
  onClose: () => void;
  versions: DecisionVersion[];
  historyLoading: boolean;
  historyError: boolean;
  onRetry: () => void;
  relTime: (iso: string) => string;
}

export function DecisionHistoryDialog({
  historyFor,
  onClose,
  versions,
  historyLoading,
  historyError,
  onRetry,
  relTime,
}: DecisionHistoryDialogProps) {
  const t = useTranslations("task");
  const tButton = useTranslations("button");
  const dialogRef = useRef<HTMLDivElement>(null);

  // 焦点管理：打开时记录之前焦点并移入模态框，关闭时恢复
  useEffect(() => {
    if (!historyFor) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = dialogRef.current;
    if (container) {
      const focusable = container.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [historyFor]);

  // Tab focus trap：在模态框内可聚焦元素间循环
  useEffect(() => {
    if (!historyFor) return;
    const container = dialogRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && container) {
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [historyFor]);

  if (!historyFor) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("versionHistory")}
      className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center bg-[var(--overlay)] pb-safe"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[80dvh] overflow-y-auto bg-[var(--surface)] sm:rounded-[var(--radius-lg)] sm:border sm:border-[var(--border)] shadow-[var(--elev-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)] sticky top-0 bg-[var(--surface)]">
          <h3 className="flex items-center gap-[var(--space-2)] text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            <History size={16} className="text-[var(--muted)]" />
            {t("versionHistoryTitle", { version: historyFor.version })}
          </h3>
          <button
            onClick={onClose}
            aria-label={tButton("close")}
            className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-[var(--space-4)] space-y-[var(--space-4)]">
          {historyLoading ? (
            <div className="space-y-[var(--space-3)]">
              <div className="h-20 w-full rounded-[var(--radius-md)] bg-[var(--surface-2)] animate-pulse" />
              <div className="h-20 w-full rounded-[var(--radius-md)] bg-[var(--surface-2)] animate-pulse" />
            </div>
          ) : versions.length === 0 ? (
            historyError ? (
              <div className="text-center">
                <p className="text-[length:var(--text-sm)] text-[var(--muted)] mb-[var(--space-2)]">
                  {t("historyLoadFailed")}
                </p>
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--accent)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                >
                  {tButton("retry")}
                </button>
              </div>
            ) : (
              <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("noHistory")}</p>
            )
          ) : (
            versions.map((v) => (
              <article
                key={v.id}
                className="border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden hover:shadow-[var(--elev-hover)] transition-shadow duration-[var(--motion-fast)]"
              >
                <header className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] bg-[var(--surface-2)] border-b border-[var(--border-soft)]">
                  <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[length:var(--text-xs)] font-[family-name:var(--font-mono)] text-[var(--fg-2)]">
                    v{v.version}
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    {v.author ? v.author.name || v.author.email : t("deletedUser")} ·{" "}
                    {relTime(v.createdAt)}
                  </span>
                </header>
                <div className="px-[var(--space-3)] py-2.5 text-[length:var(--text-sm)]">
                  <Markdown source={v.markdown} />
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
