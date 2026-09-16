"use client";

/**
 * 文本预览组件
 *
 * fetch 文件内容并显示在 <pre> 中，使用等宽字体（var(--font-mono)）。
 * 支持代码高亮（简单的 <pre> + 等宽字体，不引入高亮库）。
 * 大文件截断：超过 100KB（102400 字节）只显示前 100KB + 提示。
 *
 * 加载状态：显示 loading 提示。
 * 错误状态：显示 error 提示。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 */

import { useState, useEffect, useCallback } from "react";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

/** 大文件截断阈值：100KB */
const MAX_BYTES = 100 * 1024;

export interface TextPreviewProps {
  /** 文本文件的 URL */
  url: string;
  /** 文件名（用于推断语言，仅作 data 属性展示） */
  fileName?: string;
}

export function TextPreview({ url, fileName }: TextPreviewProps) {
  const t = useTranslations("files.preview");

  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const loadContent = useCallback(async () => {
    setLoading(true);
    setError(false);
    setTruncated(false);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // 读取为文本，截断前 MAX_BYTES 字符
      const text = await res.text();
      if (text.length > MAX_BYTES) {
        setContent(text.slice(0, MAX_BYTES));
        setTruncated(true);
      } else {
        setContent(text);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  // 加载中
  if (loading) {
    return (
      <div
        className="flex items-center justify-center w-full h-full bg-[var(--surface-2)] text-[var(--muted)] text-[length:var(--text-sm)]"
        data-testid="text-preview-loading"
      >
        {t("loading")}
      </div>
    );
  }

  // 加载失败
  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 w-full h-full bg-[var(--surface-2)] text-center px-6"
        data-testid="text-preview-error"
      >
        <AlertCircle size={16} className="text-[var(--danger)]" />
        <p className="text-[var(--muted)] text-[length:var(--text-sm)]">
          {t("error")}
        </p>
      </div>
    );
  }

  const lang = fileName?.split(".").pop()?.toLowerCase() ?? "text";

  return (
    <div
      className="relative w-full h-full overflow-auto bg-[var(--surface-2)]"
      data-testid="text-preview"
    >
      {truncated && (
        <div className="sticky top-0 z-10 flex items-center justify-center px-4 py-2 bg-[var(--warn-soft)] text-[var(--warn)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]">
          {t("tooLarge")}
        </div>
      )}
      <pre
        className="p-4 m-0 whitespace-pre-wrap break-words font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] leading-[var(--leading-relaxed)] text-[var(--fg)]"
        data-language={lang}
      >
        {content}
      </pre>
    </div>
  );
}