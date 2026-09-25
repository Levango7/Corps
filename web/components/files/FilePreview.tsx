"use client";

/**
 * 文件预览统一入口
 *
 * 根据文件类型分发到对应预览组件：
 *  - PDF → PdfPreview（iframe 原生渲染）
 *  - Office（docx/xlsx/pptx）→ OfficePreview（Microsoft Office Online Viewer）
 *  - 图片（jpg/png/gif/webp/svg）→ ImagePreview（<img> 标签）
 *  - 视频（mp4/webm/ogg）→ VideoPreview（<video> 标签 + controls）
 *  - 音频（mp3/wav/ogg）→ AudioPreview（<audio> 标签 + controls）
 *  - 文本（txt/md/json/csv/log）→ TextPreview（<pre> + fetch 内容）
 *  - 其他 → UnsupportedPreview（文件名 + 下载按钮）
 *
 * UI：顶部栏（文件名 + 关闭按钮），内容区（预览内容）。
 * ESC 键关闭，打开时锁定背景滚动。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 * 动效：transition 用 var(--motion-base)，motion-reduce 时禁用。
 */

import { useEffect, useCallback } from "react";
import { X, Download, FileText, FileWarning } from "lucide-react";
import { useTranslations } from "next-intl";
import { PdfPreview } from "./PdfPreview";
import { VideoPreview } from "./VideoPreview";
import { TextPreview } from "./TextPreview";

// ─── Props ──────────────────────────────────────────────────────

export interface FilePreviewProps {
  /** 文件可访问 URL（用于预览和下载） */
  url: string;
  /** 文件名（用于显示和类型推断） */
  fileName: string;
  /** 文件类型（扩展名，如 "pdf"、"docx"） */
  fileType: string;
  /** 关闭回调 */
  onClose: () => void;
}

// ─── 文件类型分类 ──────────────────────────────────────────────

const IMAGE_EXTS = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
const PDF_EXTS = ["pdf"];
const OFFICE_EXTS = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"];
const VIDEO_EXTS = ["mp4", "webm", "ogg", "mov", "avi"];
const AUDIO_EXTS = ["mp3", "wav", "ogg", "m4a", "flac"];
const TEXT_EXTS = [
  "txt",
  "md",
  "json",
  "csv",
  "log",
  "xml",
  "yaml",
  "yml",
  "js",
  "ts",
  "py",
  "java",
  "go",
  "rs",
];

type FileCategory = "pdf" | "office" | "image" | "video" | "audio" | "text" | "other";

/**
 * 根据文件名（扩展名）判断文件分类。
 * 按任务规格定义的扩展名列表进行匹配。
 */
export function getFileCategory(fileName: string): FileCategory {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (PDF_EXTS.includes(ext)) return "pdf";
  if (OFFICE_EXTS.includes(ext)) return "office";
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  if (TEXT_EXTS.includes(ext)) return "text";
  return "other";
}

// ─── 内联预览组件 ──────────────────────────────────────────────

/** 图片预览：居中展示，支持滚轮缩放 */
function ImagePreview({ url, fileName }: { url: string; fileName: string }) {
  return (
    <div
      className="flex items-center justify-center w-full h-full overflow-auto bg-[var(--surface-2)]"
      data-testid="image-preview"
    >
      <img
        src={url}
        alt={fileName}
        className="max-w-full max-h-full object-contain"
        draggable={false}
      />
    </div>
  );
}

/** Office 预览：使用 Microsoft Office Online Viewer */
function OfficePreview({ url }: { url: string }) {
  const t = useTranslations("files.preview");
  const viewerUrl = `https://view.officeapps.live.com/view.aspx?url=${encodeURIComponent(url)}`;

  return (
    <iframe
      src={viewerUrl}
      title={t("title")}
      className="w-full h-full border-0 bg-[var(--surface)]"
      data-testid="office-preview"
    />
  );
}

/** 音频预览：HTML5 <audio> + 原生控件 */
function AudioPreview({ url }: { url: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-6 w-full h-full bg-[var(--surface-2)]"
      data-testid="audio-preview"
    >
      <audio src={url} controls className="w-full max-w-[400px]" />
    </div>
  );
}

/** 不支持的文件类型：显示文件名 + 下载按钮 */
function UnsupportedPreview({ url, fileName }: { url: string; fileName: string }) {
  const t = useTranslations("files.preview");
  return (
    <div className="flex flex-col items-center justify-center gap-4 w-full h-full text-center px-6">
      <FileWarning size={32} className="text-[var(--meta)]" />
      <p className="text-[var(--muted)] text-[length:var(--text-sm)]">{t("unsupported")}</p>
      <a
        href={url}
        download={fileName}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-base)] motion-reduce:transition-none hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-[var(--focus-ring)]"
      >
        <Download size={14} />
        <span>{t("downloadFile")}</span>
      </a>
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

export function FilePreview({ url, fileName, fileType, onClose }: FilePreviewProps) {
  const t = useTranslations("files.preview");
  const category = getFileCategory(fileName);

  // ESC 键关闭
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
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
      aria-label={t("previewAria", { name: fileName })}
      data-testid="file-preview"
    >
      {/* ─── 顶部栏 ─── */}
      <header className="flex items-center gap-3 px-4 h-12 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <FileText size={16} className="shrink-0 text-[var(--muted)]" />
        <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
          {fileName}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={url}
            download={fileName}
            className={`${HEADER_BTN} gap-1.5 border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]`}
          >
            <Download size={14} />
            <span>{t("download")}</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeAria")}
            className={`${HEADER_BTN} w-8 px-0 text-[var(--fg-2)] hover:bg-[var(--surface-2)]`}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {/* ─── 内容区 ─── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {category === "pdf" && <PdfPreview url={url} />}
        {category === "office" && <OfficePreview url={url} />}
        {category === "image" && <ImagePreview url={url} fileName={fileName} />}
        {category === "video" && <VideoPreview url={url} />}
        {category === "audio" && <AudioPreview url={url} />}
        {category === "text" && <TextPreview url={url} fileName={fileName} />}
        {category === "other" && <UnsupportedPreview url={url} fileName={fileName} />}
      </main>
    </div>
  );
}
