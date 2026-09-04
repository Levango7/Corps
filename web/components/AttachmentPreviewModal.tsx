"use client";

/**
 * 附件预览模态（v0.4 队列第 6 项）。
 *
 * 功能：点击 IM 附件（图片/文档）弹出居中模态内联预览，免跳转免下载。
 *  - 图片：<img> 放大展示（原图）
 *  - PDF：<iframe> 浏览器原生渲染
 *  - 其余类型（docx/xlsx/zip…）：保持下载卡片语义，模态里显示文件名 + 下载按钮
 *
 * 关闭：Esc / 点击遮罩 / 右上 X。body 滚动锁定（模态打开时）。
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { X, Download, FileText } from "lucide-react";

interface AttachmentPreviewModalProps {
  attachment: {
    url: string;
    fileName: string;
    fileType: string;
  } | null;
  onClose: () => void;
}

export function AttachmentPreviewModal({ attachment, onClose }: AttachmentPreviewModalProps) {
  const t = useTranslations("attachment");

  // Esc 关闭 + body 滚动锁
  useEffect(() => {
    if (!attachment) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [attachment, onClose]);

  if (!attachment) return null;

  const isImage = attachment.fileType.startsWith("image/");
  const isPdf = attachment.fileType === "application/pdf";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("previewAria", { name: attachment.fileName })}
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-4"
      onClick={onClose}
    >
      <div
        className="max-w-[85vw] w-full sm:max-w-3xl max-h-[85vh] flex flex-col rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：文件名 + 下载 + 关闭 */}
        <header className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-soft)] shrink-0">
          <FileText size={15} className="shrink-0 text-[var(--muted)]" />
          <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)] truncate">
            {attachment.fileName}
          </span>
          <a
            href={attachment.url}
            download={attachment.fileName}
            className="shrink-0 inline-flex items-center gap-1 px-2 h-7 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors"
            aria-label={t("download")}
          >
            <Download size={13} />
          </a>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors"
          >
            <X size={15} />
          </button>
        </header>

        {/* 预览区 */}
        <div className="flex-1 min-h-0 overflow-auto bg-[var(--surface-2)]">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachment.url}
              alt={attachment.fileName}
              className="w-full h-full object-contain"
            />
          ) : isPdf ? (
            <iframe
              src={attachment.url}
              title={attachment.fileName}
              className="w-full h-full min-h-[70vh]"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-[var(--muted)]">
              <FileText size={40} className="opacity-40" />
              <p className="text-[length:var(--text-sm)]">{t("noInlinePreview")}</p>
              <a
                href={attachment.url}
                download={attachment.fileName}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors"
              >
                <Download size={14} />
                {t("download")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
