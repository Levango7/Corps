"use client";

/**
 * FileVersionRestore · 文件版本回滚确认对话框（Phase 4D §文件版本管理 UI）
 *
 * 功能：
 *  - 模态框居中显示，遮罩层半透明
 *  - 显示文件名和目标版本号
 *  - 提示信息：当前版本内容将被替换，但版本历史保留
 *  - 确认按钮：var(--accent) 背景，loading 时显示 spinner + 禁用
 *  - 取消按钮：var(--surface-2) 背景
 *  - ESC 键取消（loading 时禁用）
 *  - 点击遮罩取消（loading 时禁用）
 *
 * Design token 规范：所有色值/间距/圆角/字号走 var(--*)，禁止裸 hex。
 * 图标：lucide-react，尺寸 14。
 * 动效：transition 用 var(--motion-fast)，motion-reduce 时禁用；
 *       prefers-reduced-motion 全局降级块已在 globals.css 中处理。
 * 来源：经验 2026-09-11-prefers-reduced-motion-global-block-and-max-duration
 */

import { useEffect } from "react";
import { AlertTriangle, RotateCcw, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

// ── Props ──────────────────────────────────────────────────────

export interface FileVersionRestoreProps {
  version: number; // 要回滚到的版本号
  fileName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean; // 回滚进行中
}

// ── 主组件 ──────────────────────────────────────────────────────

export function FileVersionRestore({
  version,
  fileName,
  onConfirm,
  onCancel,
  loading,
}: FileVersionRestoreProps) {
  const t = useTranslations("files.versionRestore");

  // ESC 键取消（回滚进行中时禁用，避免误触中断）
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, loading]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--bg)]/80 p-[var(--space-4)]"
      onClick={loading ? undefined : onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-lg)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-version-restore-title"
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
          <AlertTriangle
            size={14}
            className="text-[var(--warn)]"
            aria-hidden="true"
          />
          <h3
            id="file-version-restore-title"
            className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            {t("title")}
          </h3>
        </div>

        {/* 内容 */}
        <div className="px-[var(--space-4)] py-[var(--space-4)] space-y-[var(--space-2)]">
          <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
            {t("confirmBody", { fileName, version })}
          </p>
          <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
            {t("hint")}
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-2 px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border-soft)]">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="h-9 px-3 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-3)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] cursor-pointer"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] cursor-pointer"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw size={14} aria-hidden="true" />
            )}
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}