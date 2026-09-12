"use client";

/**
 * 文件预览主容器（Phase 4C）
 *
 * 根据 file.fileType 分发到对应预览组件：
 *  - 图片 (png/jpg/gif/webp/svg/…) → ImagePreview
 *  - PDF → PdfPreview（iframe 原生渲染）
 *  - Office (docx/xlsx/pptx/…) → OfficePreview（降级下载提示）
 *  - 视频 (mp4/webm/…) → VideoPreview
 *  - 音频 (mp3/wav/…) → AudioPreview
 *  - 代码 (js/ts/py/go/json/…) → CodePreview
 *  - Markdown (md) → MarkdownPreview
 *  - 其他 → 下载提示
 *
 * UI：全屏模态框，顶部栏（文件名 + 类型标签 + 关闭/下载按钮），
 * 内容区（居中预览），底部栏（文件大小 + 类型）。
 * ESC 键关闭，打开时锁定背景滚动。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 * 动效：transition 用 var(--motion-base)，motion-reduce 时禁用。
 */

import { useEffect, useCallback } from "react";
import { X, Download, FileText } from "lucide-react";
import type { FileAsset } from "@prisma/client";
import { ImagePreview } from "./previews/ImagePreview";
import { PdfPreview } from "./previews/PdfPreview";
import { OfficePreview } from "./previews/OfficePreview";
import { CodePreview } from "./previews/CodePreview";
import { VideoPreview } from "./previews/VideoPreview";
import { AudioPreview } from "./previews/AudioPreview";
import { MarkdownPreview } from "./previews/MarkdownPreview";

// ─── Props ──────────────────────────────────────────────────────

export interface FilePreviewProps {
  file: FileAsset;
  /** 下载 URL（用于 iframe/video/audio src 及下载按钮） */
  downloadUrl?: string;
  /** 文本内容（代码/Markdown 预览用，由调用方读取文件后传入） */
  content?: string;
  /** 关闭回调 */
  onClose?: () => void;
}

// ─── 文件类型分类 ──────────────────────────────────────────────

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
const PDF_EXTS = ["pdf"];
const OFFICE_EXTS = ["docx", "xlsx", "pptx", "doc", "xls", "ppt"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "avi", "mkv"];
const AUDIO_EXTS = ["mp3", "wav", "ogg", "flac", "aac", "m4a"];
const CODE_EXTS = [
  "js", "ts", "jsx", "tsx", "py", "go", "rs", "java", "c", "cpp", "h", "hpp",
  "json", "yaml", "yml", "xml", "html", "css", "scss", "sh", "bash", "sql",
  "r", "rb", "php", "swift", "kt", "dart", "lua", "vim", "toml", "ini", "conf",
];
const MD_EXTS = ["md", "markdown"];

type FileCategory =
  | "image"
  | "pdf"
  | "office"
  | "video"
  | "audio"
  | "code"
  | "markdown"
  | "other";

/** 根据 fileType（扩展名）判断文件分类 */
function categorize(fileType: string): FileCategory {
  const ext = fileType.toLowerCase().replace(/^\./, "");
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (PDF_EXTS.includes(ext)) return "pdf";
  if (OFFICE_EXTS.includes(ext)) return "office";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (CODE_EXTS.includes(ext)) return "code";
  if (MD_EXTS.includes(ext)) return "markdown";
  return "other";
}

/** 分类 → 中文标签 */
function categoryLabel(category: FileCategory): string {
  const labels: Record<FileCategory, string> = {
    image: "图片",
    pdf: "PDF",
    office: "Office",
    video: "视频",
    audio: "音频",
    code: "代码",
    markdown: "Markdown",
    other: "文件",
  };
  return labels[category];
}

/** 字节数 → 人类可读文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── 降级提示组件 ──────────────────────────────────────────────

interface NoPreviewProps {
  message: string;
  downloadUrl?: string;
  fileName: string;
}

function NoPreview({ message, downloadUrl, fileName }: NoPreviewProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 w-full h-full text-center px-6">
      <FileText size={32} className="text-[var(--meta)]" />
      <p className="text-[var(--muted)] text-[length:var(--text-sm)]">{message}</p>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download={fileName}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-base)] motion-reduce:transition-none hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
        >
          <Download size={14} />
          <span>下载文件</span>
        </a>
      )}
    </div>
  );
}

// ─── 样式常量 ──────────────────────────────────────────────────

/** 顶部栏按钮基础样式 */
const HEADER_BTN =
  "inline-flex items-center justify-center h-8 px-2.5 rounded-[var(--radius-sm)] " +
  "text-[length:var(--text-sm)] transition-colors duration-[var(--motion-base)] " +
  "motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-[var(--focus-ring)] " +
  "cursor-pointer";

// ─── 主组件 ──────────────────────────────────────────────────────

export function FilePreview({ file, downloadUrl, content, onClose }: FilePreviewProps) {
  const category = categorize(file.fileType);

  // 需要 URL 但缺失 / 需要文本但缺失
  const urlCategories: FileCategory[] = ["image", "pdf", "office", "video", "audio"];
  const contentCategories: FileCategory[] = ["code", "markdown"];
  const needsUrlButMissing = urlCategories.includes(category) && !downloadUrl;
  const needsContentButMissing = contentCategories.includes(category) && content === undefined;

  // ESC 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose?.();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // 打开时锁定背景滚动，关闭时恢复
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-[var(--bg)]"
      role="dialog"
      aria-modal="true"
      aria-label={`${file.fileName} 预览`}
      data-testid="file-preview"
    >
      {/* ─── 顶部栏 ─── */}
      <header className="flex items-center gap-3 px-4 h-12 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
          {file.fileName}
        </span>
        <span className="shrink-0 inline-flex items-center h-5 px-2 rounded-[var(--radius-pill)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
          {categoryLabel(category)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={file.fileName}
              className={`${HEADER_BTN} gap-1.5 border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]`}
            >
              <Download size={14} />
              <span>下载</span>
            </a>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭预览"
              className={`${HEADER_BTN} w-8 px-0 text-[var(--fg-2)] hover:bg-[var(--surface-2)]`}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </header>

      {/* ─── 内容区 ─── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {category === "image" && downloadUrl && (
          <ImagePreview src={downloadUrl} fileName={file.fileName} />
        )}
        {category === "pdf" && downloadUrl && (
          <PdfPreview src={downloadUrl} />
        )}
        {category === "office" && downloadUrl && (
          <OfficePreview src={downloadUrl} fileType={file.fileType} />
        )}
        {category === "video" && downloadUrl && (
          <VideoPreview src={downloadUrl} />
        )}
        {category === "audio" && downloadUrl && (
          <AudioPreview src={downloadUrl} />
        )}
        {category === "code" && content !== undefined && (
          <CodePreview content={content} fileName={file.fileName} />
        )}
        {category === "markdown" && content !== undefined && (
          <MarkdownPreview content={content} />
        )}

        {/* 降级：不支持预览的文件类型 */}
        {category === "other" && (
          <NoPreview
            message="此文件类型不支持在线预览，请下载查看"
            downloadUrl={downloadUrl}
            fileName={file.fileName}
          />
        )}
        {/* 降级：需要 URL 但未提供 */}
        {needsUrlButMissing && (
          <NoPreview
            message="无法加载预览，请下载查看"
            downloadUrl={downloadUrl}
            fileName={file.fileName}
          />
        )}
        {/* 降级：需要文本内容但未提供 */}
        {needsContentButMissing && (
          <NoPreview
            message="无法加载文本内容，请下载查看"
            downloadUrl={downloadUrl}
            fileName={file.fileName}
          />
        )}
      </main>

      {/* ─── 底部栏 ─── */}
      <footer className="flex items-center gap-3 px-4 h-9 border-t border-[var(--border)] bg-[var(--surface)] shrink-0">
        <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
          {formatFileSize(file.fileSize)}
        </span>
        <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
          {file.fileType}
        </span>
      </footer>
    </div>
  );
}