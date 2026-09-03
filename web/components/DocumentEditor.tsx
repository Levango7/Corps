"use client";

/**
 * 文档编辑器：标题输入 + markdown 大文本框（自动保存到 working draft）+ 操作栏。
 *
 * 设计取舍：
 * - 用纯 textarea 而非第三方 markdown 编辑器：决策记录那套 textarea+Markdown 预览
 *   已被任务详情页验证可用，复用一致 UX；不引入富文本以免增加 bundle 与 XSS 面。
 * - 自动保存：onBlur（与任务描述/决策编辑器同模式）——避免每键保存风暴，
 *   失焦节流足够覆盖 99% 输入完成场景。
 * - 发布 = 把当前 markdown 快照到 publishedMarkdown + 打 publishedAt。
 * - 分享：生成 token 后展示完整 URL + 复制按钮；可一键关闭分享。
 */

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { Loader2, Share2, X, Globe, Eye, Download } from "lucide-react";
import { api } from "@/lib/api";
import Markdown from "@/components/Markdown";

interface DocumentEditorProps {
  wid: string;
  id: string;
  initial: {
    title: string;
    markdown: string;
    publishedMarkdown: string | null;
    publishedAt: string | null;
    shareToken: string | null;
  };
}

export function DocumentEditor({ wid, id, initial }: DocumentEditorProps) {
  const t = useTranslations("document");
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [markdown, setMarkdown] = useState(initial.markdown);
  const [shareToken, setShareToken] = useState(initial.shareToken);
  const [publishedAt, setPublishedAt] = useState(initial.publishedAt);
  const [shareUrl, setShareUrl] = useState<string | null>(
    initial.shareToken ? `${window.location.origin}/documents/share/${initial.shareToken}` : null,
  );
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | "share" | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  async function save(opts: { publish?: boolean } = {}) {
    if (busy) return;
    setBusy(opts.publish ? "publish" : "save");
    setError("");
    try {
      const res = await api<{
        id: string;
        publishedMarkdown: string | null;
        publishedAt: string | null;
      }>(`/api/v1/workspaces/${wid}/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, markdown, publish: !!opts.publish }),
      });
      if (opts.publish && res.publishedAt) {
        setPublishedAt(res.publishedAt);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    if (busy) return;
    setBusy("share");
    setError("");
    try {
      // 公开分享无独立端点：PATCH shareToken="rotate" 触发服务端生成新 token
      const res = await api<{ id: string; shareToken: string | null }>(
        `/api/v1/workspaces/${wid}/documents/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ shareToken: "rotate" }),
        },
      );
      if (res.shareToken) {
        setShareToken(res.shareToken);
        setShareUrl(`${window.location.origin}/documents/share/${res.shareToken}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shareFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function unshare() {
    if (busy) return;
    setBusy("share");
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ shareToken: null }),
      });
      setShareToken(null);
      setShareUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shareFailed"));
    } finally {
      setBusy(null);
    }
  }

  function back() {
    startTransition(() => router.push(`/w/${wid}/documents`));
  }

  return (
    <div className="max-w-3xl mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题 */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => save()}
        maxLength={255}
        placeholder={t("titlePlaceholder")}
        className="w-full px-0 py-2 bg-transparent text-[length:var(--text-3xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em] outline-none border-b border-transparent focus:border-[var(--border)] placeholder:text-[var(--meta)]"
      />

      {/* 工具栏 */}
      <div className="flex items-center justify-between mt-3 mb-4">
        <div className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--muted)]">
          {publishedAt && (
            <span>
              {t("publishedAt", {
                date: new Date(publishedAt).toLocaleString(),
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={back}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg-2)] transition-colors"
          >
            <X size={14} />
            {t("backToList")}
          </button>
          <button
            onClick={() => setPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <Eye size={14} />
            {preview ? t("editMode") : t("previewMode")}
          </button>
          {shareToken ? (
            <button
              onClick={unshare}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors"
            >
              <X size={14} />
              {t("unshare")}
            </button>
          ) : (
            <button
              onClick={share}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors"
            >
              <Share2 size={14} />
              {t("share")}
            </button>
          )}
          <button
            onClick={() => window.print()}
            title={t("exportPdfHint")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <Download size={14} />
            {t("exportPdf")}
          </button>
          <button
            onClick={() => save({ publish: true })}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors"
          >
            {busy === "publish" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Globe size={14} />
            )}
            {t("publish")}
          </button>
        </div>
      </div>

      {/* 分享链接条 */}
      {shareUrl && (
        <div className="mb-3 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border)] flex items-center gap-2 text-[length:var(--text-xs)]">
          <span className="text-[var(--muted)] shrink-0">{t("shareUrl")}:</span>
          <input
            value={shareUrl}
            readOnly
            className="flex-1 min-w-0 bg-transparent text-[var(--fg-2)] font-[family-name:var(--font-mono)] outline-none truncate"
          />
          <button
            onClick={() => navigator.clipboard.writeText(shareUrl).catch(() => {})}
            className="shrink-0 text-[var(--accent)] hover:underline"
          >
            {t("copy")}
          </button>
        </div>
      )}

      {/* 编辑/预览 */}
      {preview ? (
        <div className="prose prose-sm max-w-none rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] min-h-[60vh]">
          <Markdown source={markdown} />
        </div>
      ) : (
        <textarea
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          onBlur={() => save()}
          placeholder={t("markdownPlaceholder")}
          className="w-full h-[60vh] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] font-[family-name:var(--font-mono)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] resize-y"
        />
      )}

      {error && <p className="mt-2 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      <p className="mt-3 text-[length:var(--text-xs)] text-[var(--muted)] print:hidden">
        {t("autosaveHint")}
      </p>
      {/* 打印专用容器（导出 PDF）：屏幕隐藏，打印时仅此区可见 */}
      <div className="hidden print:block print-area" aria-hidden="true">
        <h1 className="text-[length:var(--text-xl)] font-[var(--weight-semibold)] mb-2">{title}</h1>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          corps · {new Date().toLocaleString()}
        </p>
        <Markdown source={markdown} />
      </div>
    </div>
  );
}
