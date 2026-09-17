"use client";

/**
 * DocumentPreview · 文档在线预览组件（云文档增强）
 *
 * 功能：
 *  - 根据 type 分发不同预览：markdown 渲染 / 代码高亮 / 图片预览 / 纯文本
 *  - 响应式布局：max-w 适配视口，移动端全宽
 *  - 复用 Markdown 组件渲染 markdown（零依赖、安全）
 *  - 代码预览：等宽字体 + 行号 + 横向滚动
 *  - 图片预览：居中 + max-h 限制 + alt 兜底
 *
 * Design token 规范：所有色值/间距/圆角/字号走 var(--*)。
 * 图标：lucide-react，尺寸 14/16。
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  Code2,
  Image as ImageIcon,
  Eye,
} from "lucide-react";
import Markdown from "@/components/Markdown";

/** 预览文档类型 */
export type DocumentPreviewType = "markdown" | "code" | "image" | "text";

/** 预览文档语言（用于代码块语法标识，仅展示用） */
export type DocumentPreviewLang = string;

interface DocumentPreviewProps {
  document: {
    title: string;
    content: string;
    type: DocumentPreviewType;
    /** 代码语言或图片 alt 提示 */
    lang?: DocumentPreviewLang;
    /** 图片 src（type=image 时必填） */
    src?: string;
  };
  /** 容器高度上限（默认 70dvh） */
  maxHeight?: string;
}

/** 从代码内容推断语言（粗略，仅用于显示标签） */
function detectLang(content: string, hint?: string): string {
  if (hint) return hint;
  if (/^\s*<\?xml/.test(content)) return "xml";
  if (/^\s*<!DOCTYPE html|<html/i.test(content)) return "html";
  if (/^\s*{[\s\S]*}$/.test(content) || /^\s*[[\s\S]*]$/.test(content)) return "json";
  if (/^\s*(import|export|const|let|function)\s/m.test(content)) return "ts";
  return "text";
}

export function DocumentPreview({
  document: doc,
  maxHeight = "70dvh",
}: DocumentPreviewProps) {
  const t = useTranslations("document");

  const lang = useMemo(
    () => (doc.type === "code" ? detectLang(doc.content, doc.lang) : doc.lang ?? ""),
    [doc.type, doc.content, doc.lang],
  );

  // 代码行号
  const codeLines = useMemo(
    () => (doc.type === "code" ? doc.content.split("\n") : []),
    [doc.type, doc.content],
  );

  return (
    <section
      className="w-full rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col"
      aria-label={t("previewLabel")}
    >
      {/* 头部：标题 + 类型徽章 */}
      <header className="flex items-center gap-2 px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border-soft)] shrink-0">
        {doc.type === "markdown" && <FileText size={16} className="text-[var(--muted)]" />}
        {doc.type === "code" && <Code2 size={16} className="text-[var(--muted)]" />}
        {doc.type === "image" && <ImageIcon size={16} className="text-[var(--muted)]" />}
        {doc.type === "text" && <Eye size={16} className="text-[var(--muted)]" />}
        <h3
          className="flex-1 min-w-0 truncate text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          title={doc.title}
        >
          {doc.title}
        </h3>
        <span className="shrink-0 inline-flex items-center gap-1 px-2 h-6 rounded-full bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--meta)] font-[weight:var(--weight-medium)] uppercase tracking-[var(--tracking-wide)]">
          {doc.type === "code" ? lang || doc.type : doc.type}
        </span>
      </header>

      {/* 内容区 */}
      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{ maxHeight }}
      >
        {doc.type === "markdown" && (
          <div className="prose prose-sm max-w-none p-[var(--space-6)]">
            <Markdown source={doc.content} />
          </div>
        )}

        {doc.type === "code" && (
          <div className="flex p-[var(--space-3)] bg-[var(--surface-2)]">
            {/* 行号列 */}
            <pre
              className="select-none text-right pr-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--meta)] font-[family-name:var(--font-mono)] tabular-nums leading-[var(--leading-relaxed)]"
              aria-hidden="true"
            >
              {codeLines.map((_, i) => `${i + 1}\n`).join("")}
            </pre>
            {/* 代码内容 */}
            <pre className="flex-1 min-w-0 overflow-x-auto text-[length:var(--text-sm)] text-[var(--fg-2)] font-[family-name:var(--font-mono)] leading-[var(--leading-relaxed)] whitespace-pre">
              <code>{doc.content}</code>
            </pre>
          </div>
        )}

        {doc.type === "image" && (
          <div className="flex items-center justify-center p-[var(--space-4)] bg-[var(--surface-2)]">
            {doc.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- 预览组件接受任意 src，不走 next/image 优化
              <img
                src={doc.src}
                alt={doc.title}
                className="max-w-full rounded-[var(--radius-md)] border border-[var(--border-soft)] object-contain"
                style={{ maxHeight: `calc(${maxHeight} - var(--space-8))` }}
                loading="lazy"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 py-[var(--space-8)] text-[var(--meta)]">
                <ImageIcon size={32} className="opacity-50" />
                <span className="text-[length:var(--text-sm)]">{t("previewImageMissing")}</span>
              </div>
            )}
          </div>
        )}

        {doc.type === "text" && (
          <pre className="p-[var(--space-6)] text-[length:var(--text-sm)] text-[var(--fg-2)] font-[family-name:var(--font-mono)] leading-[var(--leading-relaxed)] whitespace-pre-wrap break-words">
            {doc.content}
          </pre>
        )}
      </div>
    </section>
  );
}

export default DocumentPreview;