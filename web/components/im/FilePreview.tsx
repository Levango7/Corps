"use client";

/**
 * 文件预览组件
 *
 * - 图片附件（mimeType 以 image/ 开头）：显示缩略图，点击放大
 * - 其他文件：显示文件图标 + 文件名 + 文件大小
 * - 文件大小格式化：B / KB / MB / GB
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * lucide-react 图标尺寸用 14/16（项目约定）。
 */

import { useState } from "react";
import { FileText, Image as ImageIcon, Download } from "lucide-react";
import { useTranslations } from "next-intl";

interface FilePreviewProps {
  /** 附件数据 */
  attachment: {
    id: string;
    fileName: string;
    url: string;
    fileType: string;
    fileSize: number;
    thumbnailUrl: string | null;
  };
  /** 点击回调（图片点击放大或文件点击下载） */
  onClick?: () => void;
}

/** 判断是否为图片类型 */
function isImage(fileType: string): boolean {
  return fileType.startsWith("image/");
}

/**
 * 格式化文件大小：B / KB / MB / GB。
 * 采用 1024 进制，保留 1 位小数（B 不保留小数）。
 */
function formatFileSize(bytes: number): string {
  if (bytes < 0) return "0 B";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function FilePreview({ attachment, onClick }: FilePreviewProps) {
  const t = useTranslations("chat");
  const [expanded, setExpanded] = useState(false);

  const isImg = isImage(attachment.fileType);
  const sizeText = formatFileSize(attachment.fileSize);

  /** 点击图片：放大预览（或调用外部 onClick） */
  const handleImageClick = () => {
    if (onClick) {
      onClick();
    } else {
      setExpanded((prev) => !prev);
    }
  };

  // —— 图片附件：缩略图 / 放大预览 ——
  if (isImg) {
    return (
      <>
        <button
          type="button"
          onClick={handleImageClick}
          aria-label={attachment.fileName}
          className="block rounded-[var(--radius-sm)] overflow-hidden hover:opacity-90 transition-opacity duration-[var(--motion-fast)] cursor-zoom-in"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.thumbnailUrl ?? attachment.url}
            alt={attachment.fileName}
            className="max-w-[240px] max-h-[180px] object-cover"
          />
        </button>

        {/* 放大预览模态（仅无外部 onClick 时启用） */}
        {expanded && !onClick && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setExpanded(false)}
            className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[color-mix(in_srgb,var(--mix-black)_70%,transparent)] p-[var(--space-6)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachment.url}
              alt={attachment.fileName}
              className="max-w-full max-h-full object-contain rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]"
            />
          </div>
        )}
      </>
    );
  }

  // —— 普通文件：图标 + 文件名 + 大小 ——
  return (
    <a
      href={attachment.url}
      download={attachment.fileName}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors duration-[var(--motion-fast)] min-w-[200px] max-w-[280px]"
    >
      {/* 文件类型图标 */}
      {isImg ? (
        <ImageIcon size={16} className="shrink-0 text-[var(--accent)]" />
      ) : (
        <FileText size={16} className="shrink-0 text-[var(--muted)]" />
      )}

      {/* 文件名 + 大小 */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[length:var(--text-sm)] text-[var(--fg)] font-[weight:var(--weight-medium)]">
          {attachment.fileName}
        </div>
        <div className="text-[length:var(--text-xs)] text-[var(--meta)]">
          {sizeText}
        </div>
      </div>

      {/* 下载图标 */}
      <Download
        size={14}
        className="shrink-0 text-[var(--muted)]"
        aria-label={t("attachFile")}
      />
    </a>
  );
}