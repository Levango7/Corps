"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Calendar, Save, Loader2, Eye, Edit3 } from "lucide-react";
import Markdown from "@/components/Markdown";
import { consumeAiProgressStream, type AiProgressPart } from "@/components/editor/aiStream";
import { ProgressSteps, type ProgressStage } from "@/components/ai/ProgressSteps";
import { api } from "@/lib/api";
import { FeedbackButtons } from "./FeedbackButtons";

/**
 * AI 智能日报视图
 *
 * 交互流程：
 *  1. 顶部日期选择器（默认今天）+ "生成"按钮（Sparkles 图标）
 *  2. 点击生成 → 流式渲染 markdown（逐字显示，onDelta 回调）
 *  3. 生成完成后进入编辑模式（textarea 可修改）
 *  4. 底部"保存为文档"按钮 → POST /api/v1/workspaces/{wid}/documents
 *
 * 流式消费走 consumeAiStream（见 aiStream.ts），零外部依赖。
 * 样式全走 design token（var(--*)），与项目设计系统一致。
 *
 * 来源：经验 2026-09-13-dashboard-widget-registry-multi-file-extension
 *       （Widget Props 统一 { wid: string }）
 * 来源：经验 2026-09-10-tailwind-v4-utility-class-to-design-token-migration
 *       （先读取 design-tokens.css 确认可用 token，不假设名称）
 */

interface DailyReportViewProps {
  wid: string;
}

/** 组件阶段 */
type Phase = "idle" | "streaming" | "done";

export function DailyReportView({ wid }: DailyReportViewProps) {
  const t = useTranslations("ai.dailyReport");
  const tp = useTranslations("ai.progress");

  // 日期选择器：默认今天（YYYY-MM-DD）
  const todayStr = new Date().toISOString().split("T")[0]!;
  const [date, setDate] = useState(todayStr);
  const [phase, setPhase] = useState<Phase>("idle");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 进度状态：当前阶段 + 阶段消息
  const [progressStage, setProgressStage] = useState<ProgressStage | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>("");

  const abortRef = useRef<AbortController | null>(null);

  // 组件卸载时取消进行中的流式请求，避免 onDelta 回调在已卸载组件上触发 setContent
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /** 生成日报：调用流式 API（带进度反馈） */
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
    setProgressStage(null);
    setProgressMessage("");

    // date input 值为 YYYY-MM-DD，转为 ISO datetime 传给 API（zod .datetime()）
    const dateIso = `${date}T00:00:00.000Z`;

    try {
      const { text: full } = await consumeAiProgressStream(
        "/api/v1/ai/daily-report",
        { wid, date: dateIso },
        {
          signal: ac.signal,
          onDelta: (delta) => {
            setContent((prev) => prev + delta);
          },
          onProgress: (progress: AiProgressPart) => {
            setProgressStage(progress.stage);
            setProgressMessage(progress.message);
          },
        },
      );
      setContent(full);
      setPhase("done");
      setProgressStage(null);
    } catch (e) {
      // abort 不视为错误
      if ((e as Error).name === "AbortError") return;
      setError(t("generateFailed"));
      setPhase("idle");
      setProgressStage(null);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [wid, date]);

  /** 保存为文档：POST /api/v1/workspaces/{wid}/documents */
  const handleSave = useCallback(async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/v1/workspaces/${wid}/documents`, {
        method: "POST",
        body: JSON.stringify({
          title: `${t("docTitle")} - ${date}`,
          markdown: content,
        }),
      });
      setSaved(true);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [content, saving, wid, date]);

  const isStreaming = phase === "streaming";
  const hasContent = phase === "done" && content.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具栏：日期选择 + 生成按钮 */}
      <header className="flex flex-wrap items-center gap-[var(--space-3)] border-b border-[var(--border)] px-[var(--space-6)] py-[var(--space-4)]">
        <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("title")}
        </h1>

        <div className="ml-auto flex items-center gap-[var(--space-3)]">
          {/* 日期选择器 */}
          <label className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)]">
            <Calendar size={14} className="text-[var(--meta)]" />
            <span className="sr-only">{t("dateLabel")}</span>
            <input
              type="date"
              value={date}
              max={todayStr}
              disabled={isStreaming}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"
            />
          </label>

          {/* 生成按钮 */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isStreaming || !date}
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
            <p className="max-w-md text-[length:var(--text-sm)] text-[var(--meta)]">
              {t("empty")}
            </p>
          </div>
        )}

        {/* 流式生成中：进度步骤指示器 */}
        {isStreaming && progressStage && (
          <div className="mb-[var(--space-4)]">
            <ProgressSteps
              currentStage={progressStage}
              stageNames={[tp("context"), tp("analyzing"), tp("generating")]}
              currentMessage={progressMessage}
            />
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
              capability="daily-report"
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

      {/* 底部操作栏：保存为文档 */}
      {hasContent && (
        <footer className="flex items-center justify-end gap-[var(--space-3)] border-t border-[var(--border)] px-[var(--space-6)] py-[var(--space-3)]">
          {saved && (
            <span className="text-[length:var(--text-xs)] text-[var(--success)]">
              {t("saved")}
            </span>
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