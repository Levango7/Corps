"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Megaphone, Save, Loader2, Eye, Edit3 } from "lucide-react";
import Markdown from "@/components/Markdown";
import { consumeAiStream } from "@/components/editor/aiStream";
import { api } from "@/lib/api";
import { FeedbackButtons } from "./FeedbackButtons";

/**
 * AI 公告智能起草面板。
 *
 * 交互流程：
 *  1. 顶部主题输入框（可选）+ "生成"按钮（Sparkles 图标）
 *  2. 点击生成 → 流式渲染 markdown（逐字显示，onDelta 回调）
 *  3. 生成完成后可编辑（textarea）或预览（markdown）
 *  4. 底部"保存为公告"按钮 → POST /api/v1/workspaces/{wid}/announcements
 *
 * 流式消费走 consumeAiStream（见 aiStream.ts），零外部依赖。
 * 样式全走 design token（var(--*)），与项目设计系统一致。
 *
 * 来源：经验 2026-09-13-frontend-modification-five-dimension-verification
 *       （流式组件 useEffect cleanup + AbortController 模式）
 */

interface AnnouncementDraftPanelProps {
  wid: string;
}

/** 组件阶段 */
type Phase = "idle" | "streaming" | "done";

/**
 * 从生成的 markdown 中提取标题与正文。
 *
 * prompt 要求输出以 `# 标题` 开头。若首行匹配 `# xxx`，则提取为公告 title，
 * 剩余行作为 content；否则 title 留空（由调用方用默认标题兜底），content 取全文。
 */
function extractTitleAndContent(markdown: string): { title: string; content: string } {
  const lines = markdown.split("\n");
  const firstLine = lines[0]?.trim() ?? "";
  const m = /^#\s+(.+)$/.exec(firstLine);
  if (m) {
    const rest = lines.slice(1).join("\n").trim();
    return { title: m[1].trim(), content: rest };
  }
  return { title: "", content: markdown };
}

export function AnnouncementDraftPanel({ wid }: AnnouncementDraftPanelProps) {
  const t = useTranslations("ai.announcementDraft");

  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // 组件卸载时取消进行中的流式请求，避免 onDelta 回调在已卸载组件上触发 setContent
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /** 生成草稿：调用流式 API */
  const handleGenerate = useCallback(async () => {
    // 取消进行中请求
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setPhase("streaming");
    setContent("");
    setError(null);
    setSaved(false);
    setEditing(false);

    try {
      const full = await consumeAiStream(
        "/api/v1/ai/announcement-draft",
        { wid, topic: topic.trim() || undefined },
        {
          signal: ac.signal,
          onDelta: (delta) => {
            setContent((prev) => prev + delta);
          },
        },
      );
      setContent(full);
      setPhase("done");
    } catch (e) {
      // abort 不视为错误
      if ((e as Error).name === "AbortError") return;
      setError(t("generateFailed"));
      setPhase("idle");
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [wid, topic]);

  /** 保存为公告：POST /api/v1/workspaces/{wid}/announcements */
  const handleSave = useCallback(async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      // 从 markdown 提取标题（# 标题）与正文；无标题行时用默认标题兜底
      const { title: extracted, content: body } = extractTitleAndContent(content);
      const title = extracted || t("announcementTitle");
      const announcementContent = body || content;

      await api(`/api/v1/workspaces/${wid}/announcements`, {
        method: "POST",
        body: JSON.stringify({ title, content: announcementContent }),
      });
      setSaved(true);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [content, saving, wid]);

  const isStreaming = phase === "streaming";
  const hasContent = phase === "done" && content.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏：标题 + 主题输入 + 生成按钮 */}
      <header className="flex flex-wrap items-center gap-[var(--space-3)] border-b border-[var(--border)] px-[var(--space-6)] py-[var(--space-4)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Megaphone size={16} className="text-[var(--accent)]" />
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h1>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-[var(--space-3)]">
          {/* 主题输入（可选） */}
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={500}
            disabled={isStreaming}
            placeholder={t("topicPlaceholder")}
            aria-label={t("topicPlaceholder")}
            className="w-64 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"
          />

          {/* 生成按钮 */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isStreaming}
            className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {isStreaming ? (
              <>
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                {t("generating")}
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {t("generate")}
              </>
            )}
          </button>
        </div>
      </header>

      {/* 主体内容区 */}
      <div className="flex-1 overflow-y-auto px-[var(--space-6)] py-[var(--space-5)]">
        {phase === "idle" && !error && (
          <div className="flex h-full flex-col items-center justify-center gap-[var(--space-3)] text-center">
            <Sparkles size={32} className="text-[var(--meta)]" />
            <p className="max-w-md text-[length:var(--text-sm)] text-[var(--meta)]">{t("empty")}</p>
          </div>
        )}

        {error && (
          <div className="mb-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--danger)]">
            {error}
          </div>
        )}

        {hasContent && (
          <div className="flex flex-col gap-[var(--space-3)]">
            {/* 预览/编辑切换 */}
            <div className="flex items-center gap-[var(--space-2)]">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={!editing}
                className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] disabled:opacity-40"
              >
                <Eye size={14} />
                {t("preview")}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={editing}
                className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] disabled:opacity-40"
              >
                <Edit3 size={14} />
                {t("edit")}
              </button>
            </div>

            {/* 内容区：编辑模式 textarea / 预览模式 markdown */}
            {editing ? (
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setSaved(false);
                }}
                className="min-h-[400px] w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-3)] font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--fg)] leading-[var(--leading-relaxed)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
                aria-label={t("edit")}
              />
            ) : (
              <div className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]">
                <Markdown source={content} />
              </div>
            )}

            {/* AI 结果反馈按钮 */}
            <FeedbackButtons
              capability="announcement-draft"
              workspaceId={wid}
              originalOutput={content}
            />
          </div>
        )}

        {/* 流式生成中：实时渲染 markdown */}
        {isStreaming && content.length > 0 && (
          <div className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]">
            <Markdown source={content} />
          </div>
        )}
      </div>

      {/* 底部操作栏：保存为公告 */}
      {hasContent && (
        <footer className="flex items-center justify-end gap-[var(--space-3)] border-t border-[var(--border)] px-[var(--space-6)] py-[var(--space-3)]">
          {saved && (
            <span className="text-[length:var(--text-xs)] text-[var(--success)]">{t("saved")}</span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !content.trim() || saved}
            className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {saving ? (
              <>
                <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                {t("saving")}
              </>
            ) : (
              <>
                <Save size={14} />
                {t("save")}
              </>
            )}
          </button>
        </footer>
      )}
    </div>
  );
}
