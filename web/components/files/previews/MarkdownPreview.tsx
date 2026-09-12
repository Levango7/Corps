"use client";

/**
 * Markdown 预览组件
 *
 * 复用项目现有的极简 Markdown 渲染器（@/components/Markdown），
 * 零依赖、不使用 dangerouslySetInnerHTML，覆盖标题/列表/引用/
 * 代码块/行内代码/加粗/斜体/链接/分隔线等语法。
 *
 * 内容区限宽 var(--prose-max)（720px）保证长文阅读体验。
 *
 * 所有样式走 design token（var(--*)），无裸 hex。
 */

import Markdown from "@/components/Markdown";

export interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div
      className="w-full h-full overflow-auto px-6 py-4 bg-[var(--surface)]"
      data-testid="markdown-preview"
    >
      <div className="mx-auto max-w-[var(--prose-max)]">
        <Markdown source={content} />
      </div>
    </div>
  );
}