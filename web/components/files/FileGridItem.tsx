"use client";

/**
 * FileGridItem · 文件网格视图项（Phase 4B 云盘）
 *
 * 网格视图中的卡片式文件项：缩略图（图片）或大图标 + 文件名 + 大小。
 * 复用 FileListItem 导出的 formatFileSize / getFileIcon 辅助函数。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 32（网格大图标）。
 * 动效：card-lift（hover 微抬升 + 柔化投影），motion-reduce 时禁用。
 */

import { useState } from "react";
import type { FileAsset } from "@prisma/client";
import { Check, Trash2 } from "lucide-react";
import { formatFileSize, getFileIcon } from "./FileListItem";
import { useTranslations } from "next-intl";

// ─── Props ──────────────────────────────────────────────────────

export interface FileGridItemProps {
  file: FileAsset;
  selected?: boolean;
  onClick?: () => void;
  onSelect?: () => void;
  onDelete?: () => void;
}

// ─── 组件 ────────────────────────────────────────────────────────

export function FileGridItem({
  file,
  selected = false,
  onClick,
  onSelect,
  onDelete,
}: FileGridItemProps) {
  const t = useTranslations("files.fileGridItem");
  const Icon = getFileIcon(file.fileType);
  const isImage = file.fileType.toLowerCase().startsWith("image/");
  const [imgError, setImgError] = useState(false);
  const showThumbnail = isImage && !!file.thumbnailKey && !imgError;

  // 缩略图 URL：通过 download 端点获取（img 加载失败时回退到文件图标）
  const thumbnailUrl = `/api/v1/workspaces/${file.workspaceId}/files/${file.id}/download`;

  return (
    <div
      role="gridcell"
      onClick={onClick}
      className={
        "group relative flex flex-col rounded-[var(--radius-md)] border bg-[var(--surface)] " +
        "transition-all duration-[var(--motion-base)] motion-reduce:transition-none " +
        "hover:-translate-y-0.5 hover:shadow-[var(--elev-hover)] motion-reduce:hover:translate-y-0 " +
        (onClick ? "cursor-pointer " : "") +
        (selected ? "border-[var(--accent)]" : "border-[var(--border)]")
      }
    >
      {/* 选择复选框（左上角，选中时常驻、否则 hover/focus 显示） */}
      {onSelect && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? t("unselectAria") : t("selectAria")}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className={
            "absolute top-2 left-2 w-5 h-5 rounded-[var(--radius-sm)] border flex items-center justify-center " +
            "transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none " +
            "focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] " +
            (selected
              ? "bg-[var(--accent)] border-[var(--accent)] opacity-100"
              : "bg-[var(--surface)] border-[var(--border)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:border-[var(--accent)]")
          }
        >
          {selected && (
            <Check size={12} className="text-[var(--accent-fg)]" strokeWidth={3} />
          )}
        </button>
      )}

      {/* 删除按钮（右上角，hover/focus 显示） */}
      {onDelete && (
        <button
          type="button"
          aria-label={t("deleteAria")}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 w-6 h-6 inline-flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
        >
          <Trash2 size={14} />
        </button>
      )}

      {/* 缩略图 / 大图标区域 */}
      <div className="flex items-center justify-center h-28 border-b border-[var(--border-soft)] bg-[var(--surface-2)] overflow-hidden">
        {showThumbnail ? (
          <img
            src={thumbnailUrl}
            alt={file.fileName}
            loading="lazy"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon size={32} className="text-[var(--muted)]" strokeWidth={1.5} />
        )}
      </div>

      {/* 文件信息 */}
      <div className="flex flex-col gap-0.5 p-2.5">
        <span
          className="text-[length:var(--text-sm)] text-[var(--fg)] line-clamp-2 leading-[var(--leading-snug)]"
          title={file.fileName}
        >
          {file.fileName}
        </span>
        <span className="text-[length:var(--text-xs)] text-[var(--muted)] tabular-nums">
          {formatFileSize(file.fileSize)}
        </span>
      </div>
    </div>
  );
}