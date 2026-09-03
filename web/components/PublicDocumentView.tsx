"use client";

/**
 * 文档查看页：只读渲染 publishedMarkdown（已发布快照）。
 * 公开分享页（/documents/share/[token]）也用这个组件。
 *
 * 与决策记录的渲染不同：决策用 DecisionEditor 内部嵌入的 Markdown；
 * 文档用纯展示组件，标题列外带工作区 + 作者 + 发布时间脚注。
 */

import { useTranslations } from "next-intl";
import Markdown from "@/components/Markdown";

interface PublicDocumentViewProps {
  title: string;
  markdown: string;
  workspace?: { name: string; slug: string } | null;
  author?: { name: string | null } | null;
  publishedAt?: string | null;
  /** 公开分享模式下不显示作者身份（无 name 时显示"匿名"） */
  redacted?: boolean;
}

export function PublicDocumentView({
  title,
  markdown,
  workspace,
  author,
  publishedAt,
  redacted = false,
}: PublicDocumentViewProps) {
  const t = useTranslations("document");
  const authorName = author?.name || (redacted ? t("anonymous") : t("unknownAuthor"));

  return (
    <article className="max-w-3xl mx-auto px-[var(--space-4)] py-[var(--space-10)]">
      <header className="mb-[var(--space-6)] pb-[var(--space-4)] border-b border-[var(--border-soft)]">
        <h1 className="text-[length:var(--text-3xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          {title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          {workspace && (
            <span>
              {t("workspaceLabel")}:{" "}
              <strong className="text-[var(--fg-2)]">{workspace.name}</strong>
            </span>
          )}
          <span>·</span>
          <span>
            {t("authorLabel")}: <strong className="text-[var(--fg-2)]">{authorName}</strong>
          </span>
          {publishedAt && (
            <>
              <span>·</span>
              <span>
                {t("publishedAt", {
                  date: new Date(publishedAt).toLocaleString(),
                })}
              </span>
            </>
          )}
        </div>
      </header>

      <div className="prose prose-sm max-w-none">
        <Markdown source={markdown} />
      </div>

      <footer className="mt-[var(--space-10)] pt-[var(--space-4)] border-t border-[var(--border-soft)] text-[length:var(--text-xs)] text-[var(--meta)]">
        {t("footerHint", { product: "corps" })}
      </footer>
    </article>
  );
}
