"use client";

/**
 * 代码预览组件
 *
 * 使用等宽字体（var(--font-mono)）显示源代码，左侧带行号。
 * 行号在水平滚动时固定（sticky），代码区域可水平滚动。
 * 暗色模式自动适配（背景/文字用语义 token）。
 *
 * 简化方案：无语法高亮，纯文本展示。
 * 如需高亮，后续可接入 highlight.js 或 Shiki（当前不引入新依赖）。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 */

import { useMemo } from "react";

export interface CodePreviewProps {
  content: string;
  fileName: string;
  language?: string;
}

export function CodePreview({ content, fileName, language }: CodePreviewProps) {
  const lines = useMemo(() => content.split("\n"), [content]);
  const lang = language ?? (fileName.split(".").pop() || "text");

  return (
    <div
      className="w-full h-full overflow-auto bg-[var(--surface-2)] font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] leading-[var(--leading-relaxed)]"
      data-language={lang}
      aria-label={`${fileName} 代码预览`}
      data-testid="code-preview"
    >
      <div className="py-3 inline-block min-w-full">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span
              className="sticky left-0 z-10 shrink-0 w-14 pl-4 pr-3 text-right text-[length:var(--text-xs)] text-[var(--meta)] bg-[var(--surface-2)] select-none"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <code className="flex-1 pl-3 pr-4 whitespace-pre text-[var(--fg)]">
              {line}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}