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

import { useState, useRef, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { Loader2, Share2, X, Globe, Eye, Download, Columns2, Zap, Check } from "lucide-react";
import { api } from "@/lib/api";
import Markdown from "@/components/Markdown";
import { MarkdownToolbar, useEditorKeys } from "@/components/MarkdownToolbar";
import { QuickDiagram } from "@/components/QuickDiagram";
import { useToast } from "@/components/Toast";

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
  const tDiagram = useTranslations("diagramQuick");
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState(initial.title);
  const [markdown, setMarkdown] = useState(initial.markdown);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [shareToken, setShareToken] = useState(initial.shareToken);
  const [publishedAt, setPublishedAt] = useState(initial.publishedAt);
  const [shareUrl, setShareUrl] = useState<string | null>(
    initial.shareToken ? `${window.location.origin}/documents/share/${initial.shareToken}` : null,
  );
  const [preview, setPreview] = useState(false);
  /** 分屏模式（v0.6）：编辑与预览并排实时渲染（Obsidian 式），与单页切换互斥 */
  const [split, setSplit] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | "share" | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  // LI-10：复制分享链接成功反馈（短暂打勾替代文案，2s 后恢复）
  const [copied, setCopied] = useState(false);
  // 自动保存成功反馈：短暂显示"已保存"提示（2s 后消失）
  const [savedFlash, setSavedFlash] = useState(false);

  // Typora 式快捷键层（Ctrl+B/I/K、列表续行、Tab 缩进）——与工具栏共用实现
  const handleKeyDown = useEditorKeys({
    textareaRef: editorRef,
    value: markdown,
    onChange: setMarkdown,
  });
  /** 快速图表对话框：插入 ```mermaid 块到正文（追加到末尾，编辑器语义里"出一张图"） */
  const [quickDiagramOpen, setQuickDiagramOpen] = useState(false);

  function insertDiagramBlock(block: string) {
    const sep = markdown.endsWith("\n") || markdown === "" ? "" : "\n\n";
    setMarkdown(markdown + sep + block);
  }

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
      // 自动保存成功：短暂显示"已保存"提示（非发布场景）
      if (!opts.publish) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
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

  /** LI-10：复制分享链接并给出 2s 视觉反馈 */
  async function copyShareUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板权限失败：提示用户复制失败 */
      toast("error", t("copyFailed"));
    }
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
        className="w-full px-0 py-2 bg-transparent text-[length:var(--text-3xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em] outline-none border-b border-transparent focus:border-[var(--border)] placeholder:text-[var(--meta)]"
      />

      {/* 工具栏 */}
      <div className="flex items-center justify-between mt-3 mb-4">
        <div className="flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--muted)]">
          {/* LI-10：自动保存中指示器 */}
          {busy === "save" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              {t("saving")}
            </span>
          )}
          {/* 自动保存成功反馈：短暂显示"已保存"提示 */}
          {savedFlash && busy !== "save" && (
            <span className="inline-flex items-center gap-1 text-[var(--success)]">
              <Check size={12} />
              {t("saved")}
            </span>
          )}
          {publishedAt && (
            <span>
              {t("publishedAt", {
                date: new Date(publishedAt).toLocaleString(),
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={back}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <X size={14} />
            {t("backToList")}
          </button>
          <button
            onClick={() => setPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <Eye size={14} />
            {preview ? t("editMode") : t("previewMode")}
          </button>
          <button
            onClick={() => {
              setSplit((v) => !v);
              setPreview(false);
            }}
            aria-pressed={split}
            className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
              split
                ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--surface-2)]"
                : "border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
            }`}
            title={t("splitHint")}
          >
            <Columns2 size={14} />
            {t("splitMode")}
          </button>
          {/* 快速图表：不进正文也能出图，确认后一键插入（v0.6 增补） */}
          <button
            onClick={() => setQuickDiagramOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            title={tDiagram("title")}
          >
            <Zap size={14} />
            <span className="hidden sm:inline">{tDiagram("title")}</span>
          </button>
          {shareToken ? (
            <button
              onClick={unshare}
              disabled={busy !== null}
              title={busy !== null ? t("saveFailed") : undefined}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              <X size={14} />
              {t("unshare")}
            </button>
          ) : (
            <button
              onClick={share}
              disabled={busy !== null}
              title={busy !== null ? t("saveFailed") : undefined}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              <Share2 size={14} />
              {t("share")}
            </button>
          )}
          <button
            onClick={() => window.print()}
            title={t("exportPdfHint")}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <Download size={14} />
            {t("exportPdf")}
          </button>
          <button
            onClick={() => save({ publish: true })}
            disabled={busy !== null}
            title={busy !== null ? t("saveFailed") : undefined}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
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
            onClick={copyShareUrl}
            className="shrink-0 inline-flex items-center gap-1 text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
          >
            {copied ? <Check size={12} /> : null}
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
      )}

      {/* 编辑/预览/分屏 */}
      {preview ? (
        <div className="prose prose-sm max-w-none rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] min-h-[60vh]">
          <Markdown source={markdown} />
        </div>
      ) : split ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <div>
            <div className="mb-2">
              <MarkdownToolbar textareaRef={editorRef} value={markdown} onChange={setMarkdown} />
            </div>
            <textarea
              ref={editorRef}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => save()}
              placeholder={t("markdownPlaceholder")}
              className="w-full h-[60vh] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] font-[family-name:var(--font-mono)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] resize-y"
            />
          </div>
          <div className="prose prose-sm max-w-none rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] min-h-[60vh] overflow-y-auto lg:max-h-[calc(60vh+2rem)]">
            <Markdown source={markdown} />
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2">
            <MarkdownToolbar textareaRef={editorRef} value={markdown} onChange={setMarkdown} />
          </div>
          <textarea
            ref={editorRef}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => save()}
            placeholder={t("markdownPlaceholder")}
            className="w-full h-[60vh] p-[var(--space-4)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] font-[family-name:var(--font-mono)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)] resize-y"
          />
        </>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-2 text-[length:var(--text-sm)] text-[var(--danger)]">
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError("")}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
            aria-label={t("backToList")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 快速图表对话框（编辑模式下从顶栏唤起） */}
      <QuickDiagram
        open={quickDiagramOpen}
        onClose={() => setQuickDiagramOpen(false)}
        onInsert={insertDiagramBlock}
      />

      <div className="mt-3 flex items-center justify-between gap-3 print:hidden">
        <p className="text-[length:var(--text-xs)] text-[var(--muted)]">{t("autosaveHint")}</p>
        {/* 字数统计（v0.6）：去 Markdown 标记后的近似可读字数 */}
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] tabular-nums">
          {t("wordCount", {
            count: markdown
              .replace(/[#>*`\-_|~[\]()]/g, " ")
              .split(/\s+/)
              .filter(Boolean).length,
          })}
        </p>
      </div>
      {/* 打印专用容器（导出 PDF）：屏幕隐藏，打印时仅此区可见 */}
      <div className="hidden print:block print-area" aria-hidden="true">
        <h1 className="text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] mb-2">{title}</h1>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          corps · {new Date().toLocaleString()}
        </p>
        <Markdown source={markdown} />
      </div>
    </div>
  );
}
