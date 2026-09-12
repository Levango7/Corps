"use client";

/**
 * FileListItem · 文件列表视图项（Phase 4B 云盘）
 *
 * 列表视图中的单行文件项：选择复选框 + 文件类型图标 + 文件名 + 大小 + 日期 + 操作。
 * 导出 formatFileSize / getFileIcon / formatDate 辅助函数供 FileGridItem 复用，
 * 避免创建额外工具文件，保持 4 文件约束。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 * 动效：transition 用 var(--motion-fast)，motion-reduce 时禁用。
 */

import type { FileAsset } from "@prisma/client";
import {
  File,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Code,
  Trash2,
  Check,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

// ─── 辅助函数（导出供 FileGridItem 复用）──────────────────────

/** 文件大小格式化：B/KB/MB/GB，保留 1 位小数 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** 文件类型 → lucide 图标映射（按 MIME type 前缀/关键字判断） */
export function getFileIcon(fileType: string): LucideIcon {
  const ft = fileType.toLowerCase();
  if (ft.startsWith("image/")) return ImageIcon;
  if (ft.startsWith("video/")) return Film;
  if (ft.startsWith("audio/")) return Music;
  if (ft.includes("pdf")) return FileText;
  if (
    ft.includes("javascript") ||
    ft.includes("typescript") ||
    ft.includes("python") ||
    ft.includes("json") ||
    ft.includes("html") ||
    ft.includes("css") ||
    ft.includes("xml") ||
    ft.includes("java") ||
    ft.includes("go") ||
    ft.includes("markdown")
  ) {
    return Code;
  }
  if (ft.startsWith("text/")) return FileText;
  return File;
}

/** 日期格式化为 YYYY-MM-DD（用 new Date() 包装以兼容序列化 string，运行时健壮） */
export function formatDate(date: Date): string {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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