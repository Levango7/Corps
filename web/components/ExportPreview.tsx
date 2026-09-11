"use client";

/**
 * 导出预览模态框（F4：Markdown → PDF/HTML 导出 + 批量导出增强）
 *
 * 功能：
 *  - 模态框内显示打印预览（Markdown 渲染为 HTML，复用 @/components/Markdown）
 *  - 底部「打印 / 保存为 PDF」按钮 → window.print()
 *  - 遮罩点击关闭 + Escape 键关闭 + body 滚动锁定 + 焦点管理
 *  - 批量模式（batchMode=true）：
 *      · 预览区显示目录页 + 所有文档内容（通过 documents prop）
 *      · 标题显示"批量导出 (N个文档)"
 *      · 打印按钮文字改为"打印全部"
 *
 * 打印策略（复用 globals.css 已有的 .print-area 方案）：
 *  - 模态框本身用 data-print="hide" 标记，打印时 display:none
 *  - 模态框外渲染一个独立的 .print-area 容器（hidden print:block），
 *    打印时仅此区可见，内容 = 标题 + Markdown 渲染结果
 *  - 点击打印按钮 → window.print()，浏览器打印对话框中选「另存为 PDF」
 *
 * 设计 token：所有颜色/间距/圆角/字号均引用 var(--token)，无硬编码色值。
 */

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { X, Printer } from "lucide-react";
import Markdown from "@/components/Markdown";

/** 批量模式下的单个文档数据 */
export interface BatchDocument {
  title: string;
  markdown: string;
}

export interface ExportPreviewProps {
  /** 导出文档标题（显示在预览顶部 + 打印页标题） */
  title: string;
  /** Markdown 源文本（单文档模式使用） */
  markdown: string;
  /** 模态框是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 可选元信息行（如"v1 · 张三 · 2026-09-11"），显示在标题下方 */
  metaLine?: string;
  /** 批量导出模式（可选，默认 false） */
  batchMode?: boolean;
  /** 批量导出文档列表（batchMode=true 时使用） */
  documents?: BatchDocument[];
  /** 批量导出回调（可选，用于父组件感知批量导出触发） */
  onBatchExport?: (documentIds: string[]) => void;
}

export function ExportPreview({
  title,
  markdown,
  open,
  onClose,
  metaLine,
  batchMode = false,
  documents = [],
  onBatchExport,
}: ExportPreviewProps) {
  const t = useTranslations("exportPreview");
  // 焦点陷阱：记录打开前焦点，模态打开时移入关闭按钮，关闭时恢复
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Escape 关闭 + body 滚动锁 + 焦点管理
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 记录打开前焦点，模态打开后聚焦关闭按钮
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const hasContent = batchMode
    ? documents.length > 0
    : markdown.trim().length > 0;

  // 批量模式标题：显示"批量导出 (N个文档)"
  const displayTitle = batchMode
    ? t("batchTitle", { count: documents.length })
    : title;

  // 批量模式打印按钮文字
  const printLabel = batchMode ? t("printAll") : t("print");

  // 批量模式预览标签
  const previewLabel = batchMode ? t("batchPreviewLabel") : t("previewLabel");

  return (
    <>
      {/* ── 模态框（屏幕显示，打印时 data-print="hide" 隐藏）── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("dialogLabel")}
        data-print="hide"
        className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-4 modal-overlay"
        onClick={onClose}
      >
        <div
          className="flex flex-col w-full max-w-3xl max-h-[85dvh] rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] overflow-hidden modal-enter"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部：标题 + 关闭 */}
          <header className="flex items-center gap-2 px-[var(--space-4)] py-2.5 border-b border-[var(--border-soft)] shrink-0">
            <span className="flex-1 min-w-0 text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
              {displayTitle}
            </span>
            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label={t("close")}
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <X size={16} />
            </button>
          </header>

          {/* 预览区：Markdown 渲染 */}
          <div className="flex-1 min-h-0 overflow-auto px-[var(--space-6)] py-[var(--space-4)] bg-[var(--surface)]">
            <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-[var(--space-2)] uppercase tracking-[var(--tracking-caps)]">
              {previewLabel}
            </p>
            {hasContent ? (
              batchMode ? (
                /* ── 批量模式：目录页 + 所有文档 ── */
                <div className="prose prose-sm max-w-none text-[var(--fg-2)]">
                  {/* 目录页 */}
                  {documents.length > 1 && (
                    <div className="mb-[var(--space-8)] pb-[var(--space-4)] border-b border-[var(--border-soft)]">
                      <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-3)]">
                        {t("tableOfContents")}
                      </h2>
                      <ol className="list-decimal pl-[var(--space-5)] space-y-[var(--space-1)]">
                        {documents.map((doc, idx) => (
                          <li key={idx}>
                            <a
                              href={`#batch-doc-${idx}`}
                              className="text-[var(--accent)] hover:underline underline-offset-2"
                            >
                              {doc.title}
                            </a>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {/* 每个文档 */}
                  {documents.map((doc, idx) => (
                    <div
                      key={idx}
                      id={`batch-doc-${idx}`}
                      className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-[var(--border-soft)] last:border-b-0"
                    >
                      <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-3)]">
                        {doc.title}
                      </h2>
                      <Markdown source={doc.markdown} />
                    </div>
                  ))}
                </div>
              ) : (
                /* ── 单文档模式（保持原逻辑不变）── */
                <div className="prose prose-sm max-w-none text-[var(--fg-2)]">
                  {metaLine && (
                    <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-[var(--space-3)]">
                      {metaLine}
                    </p>
                  )}
                  <Markdown source={markdown} />
                </div>
              )
            ) : (
              <p className="text-[length:var(--text-sm)] text-[var(--muted)] py-[var(--space-8)] text-center">
                {t("emptyContent")}
              </p>
            )}
          </div>

          {/* 底部操作栏：打印按钮 */}
          <footer className="flex items-center justify-between gap-2 px-[var(--space-4)] py-[var(--space-3)] border-t border-[var(--border-soft)] shrink-0">
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("printHint")}
            </span>
            <button
              onClick={() => {
                if (batchMode && onBatchExport) {
                  // 批量模式：触发回调（父组件可做埋点等），然后打印
                  onBatchExport([]);
                }
                window.print();
              }}
              disabled={!hasContent}
              className="inline-flex items-center gap-1.5 h-9 px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              <Printer size={15} />
              {printLabel}
            </button>
          </footer>
        </div>
      </div>

      {/* ── 打印专用容器（屏幕隐藏，打印时仅此区可见）──
          复用 globals.css 的 .print-area 方案：
          - hidden print:block → 平时 display:none，打印时 display:block
          - .print-area → 打印时 visibility:visible + 绝对定位全屏 + 强制浅色 token */}
      <div className="hidden print:block print-area" aria-hidden="true">
        {batchMode ? (
          <>
            {/* 批量模式打印：目录 + 所有文档 */}
            <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] mb-[var(--space-4)]">
              {displayTitle}
            </h1>
            {documents.length > 1 && (
              <div className="mb-[var(--space-8)] pb-[var(--space-4)] border-b border-[var(--border-soft)]">
                <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] mb-[var(--space-3)]">
                  {t("tableOfContents")}
                </h2>
                <ol className="list-decimal pl-[var(--space-5)] space-y-[var(--space-1)]">
                  {documents.map((doc, idx) => (
                    <li key={idx}>
                      <a href={`#batch-doc-${idx}`}>{doc.title}</a>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {documents.map((doc, idx) => (
              <div
                key={idx}
                id={`batch-doc-${idx}`}
                className="mb-[var(--space-8)] pb-[var(--space-6)] border-b border-[var(--border-soft)] last:border-b-0"
                style={{ pageBreakAfter: "always" }}
              >
                <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] mb-[var(--space-3)]">
                  {doc.title}
                </h2>
                <Markdown source={doc.markdown} />
              </div>
            ))}
          </>
        ) : (
          <>
            {/* 单文档模式打印（保持原逻辑不变） */}
            <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] mb-[var(--space-2)]">
              {title}
            </h1>
            {metaLine && (
              <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-[var(--space-4)]">
                {metaLine}
              </p>
            )}
            {hasContent ? (
              <Markdown source={markdown} />
            ) : (
              <p>—</p>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default ExportPreview;
