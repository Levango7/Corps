"use client";

// 保持 "use client"：接收 3 个函数 props（onClick/onSelect/onDelete），
// 这些回调来自 client 父组件 (FileBrowser.tsx)，无法跨越 server/client 边界传递。
// FileBrowser 管理选中状态和删除逻辑，本组件仅做展示 + 回调转发。
// 辅助函数已提取到 file-utils.ts（纯函数，可在 server/client 通用）。

import type { FileAsset } from "@prisma/client";
import { Trash2, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatFileSize, getFileIcon, formatDate } from "./file-utils";

// ─── Props ──────────────────────────────────────────────────────

export interface FileListItemProps {
  file: FileAsset;
  selected?: boolean;
  onClick?: () => void;
  onSelect?: () => void;
  onDelete?: () => void;
}

// ─── 组件 ────────────────────────────────────────────────────────

export function FileListItem({
  file,
  selected = false,
  onClick,
  onSelect,
  onDelete,
}: FileListItemProps) {
  const t = useTranslations("files.fileListItem");
  const Icon = getFileIcon(file.fileType);

  return (
    <div
      role="row"
      onClick={onClick}
      className={
        "group flex items-center gap-3 px-3 h-11 border-b border-[var(--border-soft)] " +
        "transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none " +
        (onClick ? "cursor-pointer " : "") +
        (selected ? "bg-[var(--surface-3)]" : "hover:bg-[var(--surface-2)]")
      }
    >
      {/* 选择复选框 */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? t("unselectAria") : t("selectAria")}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.();
        }}
        className={
          "shrink-0 w-4 h-4 rounded-[var(--radius-sm)] border flex items-center justify-center " +
          "transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none " +
          "focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] " +
          (selected
            ? "bg-[var(--accent)] border-[var(--accent)]"
            : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--accent)]")
        }
      >
        {selected && (
          <Check size={10} className="text-[var(--accent-fg)]" strokeWidth={3} />
        )}
      </button>

      {/* 文件类型图标 */}
      <Icon size={14} className="shrink-0 text-[var(--muted)]" />

      {/* 文件名 */}
      <span className="flex-1 min-w-0 truncate text-[length:var(--text-sm)] text-[var(--fg)]">
        {file.fileName}
      </span>

      {/* 文件大小 */}
      <span className="shrink-0 w-16 text-right text-[length:var(--text-xs)] text-[var(--muted)] tabular-nums">
        {formatFileSize(file.fileSize)}
      </span>

      {/* 上传日期 */}
      <span className="shrink-0 w-24 text-right text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
        {formatDate(file.createdAt)}
      </span>

      {/* 操作按钮：删除（hover/focus 显示） */}
      <div className="shrink-0 w-8 flex items-center justify-end opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[var(--motion-fast)] motion-reduce:transition-none">
        {onDelete && (
          <button
            type="button"
            aria-label={t("deleteAria")}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="w-6 h-6 inline-flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
