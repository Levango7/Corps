"use client";

/**
 * AI 项目经理洞察视图。
 *
 * 4 个 tab（进度分析 / 风险识别 / 综合概览 / 周报），切换时自动调用
 * POST /api/v1/ai/project-insight 流式接口，逐字渲染 markdown。
 * 周报模式下额外显示"保存为文档"按钮，将生成内容存为工作区文档。
 *
 * 技术要点：
 *  - consumeAiStream 消费 toUIMessageStreamResponse 流，onDelta 逐字累加
 *  - AbortController 在 tab 切换/卸载时中止上一个请求，避免竞态
 *  - cancelled 标志双重保护：即使 abort 后有微任务残留也不污染 content
 *  - 样式全走 design token（var(--*)），与 AiChatPanel 同风格
 *
 * 来源：经验 2026-09-13-dashboard-widget-registry-multi-file-extension
 *       （组件 Props 统一 { wid: string }，数据通过 hook/API 加载）
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  LayoutDashboard,
  FileText,
  Save,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Markdown from "@/components/Markdown";
import { consumeAiProgressStream, type AiProgressPart } from "@/components/editor/aiStream";
import { ProgressSteps, type ProgressStage } from "@/components/ai/ProgressSteps";
import { FeedbackButtons } from "./FeedbackButtons";
import { api } from "@/lib/api";

type Scope = "progress" | "risk" | "summary" | "weekly";

/** tab 配置：scope + 图标 + i18n 键 */
const TABS: ReadonlyArray<{ scope: Scope; Icon: typeof Sparkles; labelKey: string }> = [
  { scope: "progress", Icon: TrendingUp, labelKey: "tabProgress" },
  { scope: "risk", Icon: AlertTriangle, labelKey: "tabRisk" },
  { scope: "summary", Icon: LayoutDashboard, labelKey: "tabSummary" },
  { scope: "weekly", Icon: FileText, labelKey: "tabWeekly" },
];

interface ProjectInsightViewProps {
  /** 工作区 ID */
  wid: string;
}

/** 保存状态 */
type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ProjectInsightView({ wid }: ProjectInsightViewProps) {
  const t = useTranslations("ai.projectInsight");
  const tp = useTranslations("ai.progress");

  const [activeScope, setActiveScope] = useState<Scope>("progress");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  // 进度状态：当前阶段 + 阶段消息
  const [progressStage, setProgressStage] = useState<ProgressStage | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>("");

  const abortRef = useRef<AbortController | null>(null);

  /** 加载洞察（提取为可重试函数） */
  const loadInsight = () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    let cancelled = false;

    setLoading(true);
    setHasError(false);
    setContent("");
    setSaveStatus("idle");
    setProgressStage(null);
    setProgressMessage("");

    consumeAiProgressStream(
      "/api/v1/ai/project-insight",
      { wid, scope: activeScope },
      {
        signal: ac.signal,
        onDelta: (delta) => {
          if (!cancelled) setContent((prev) => prev + delta);
        },
        onProgress: (progress: AiProgressPart) => {
          if (!cancelled) {
            setProgressStage(progress.stage);
            setProgressMessage(progress.message);
          }
        },
      },
    )
      .then(({ text: full }) => {
        if (!cancelled) {
          setContent(full);
          setLoading(false);
          setProgressStage(null);
        }
      })
      .catch(() => {
        if (!cancelled && !ac.signal.aborted) {
          setHasError(true);
          setLoading(false);
          setProgressStage(null);
        }
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  };

  // 切换 tab / 挂载时自动调用 API 流式获取洞察（带进度反馈）
  useEffect(() => {
    const cleanup = loadInsight();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScope, wid]);

  /** 切换 tab（点击当前激活 tab 时跳过，避免重复请求） */
  const handleTabClick = (scope: Scope) => {
    if (scope !== activeScope) setActiveScope(scope);
  };

  /** 保存为文档（仅周报模式） */
  const handleSave = async () => {
    if (!content || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      await api(`/api/v1/workspaces/${wid}/documents`, {
        method: "POST",
        body: JSON.stringify({
          title: t("weeklyDocTitle"),
          markdown: content,
        }),
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  };

  const canSave = activeScope === "weekly" && !!content && !loading && !hasError;

  return (
    <div
      className="flex h-full flex-col bg-[var(--surface)]"
      aria-label={t("title")}
    >
      {/* 标题栏 */}
      <header className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-2)]">
          <Sparkles size={14} className="text-[var(--accent)]" />
          <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h1>
        </div>
      </header>

      {/* Tab 栏 */}
      <nav className="flex items-center gap-[var(--space-1)] border-b border-[var(--border)] px-[var(--space-5)]">
        {TABS.map(({ scope, Icon, labelKey }) => {
          const active = scope === activeScope;
          return (
            <button
              key={scope}
              type="button"
              onClick={() => handleTabClick(scope)}
              className={`inline-flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-3)] text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                active
                  ? "border-b-2 border-[var(--accent)] font-[weight:var(--weight-medium)] text-[var(--fg)]"
                  : "border-b-2 border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon size={14} />
              {t(labelKey)}
            </button>
          );
        })}
      </nav>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-[var(--space-5)] py-[var(--space-4)]">
        {/* 错误提示 */}
        {hasError && (
          <div className="flex flex-col gap-[var(--space-3)]">
            <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)]">
              <AlertTriangle size={14} className="text-[var(--danger)]" />
              <span className="text-[length:var(--text-sm)] text-[var(--danger)]">
                {t("error")}
              </span>
            </div>
            <button
              type="button"
              onClick={loadInsight}
              className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <RefreshCw size={14} />
              {t("retry")}
            </button>
          </div>
        )}

        {/* 进度步骤指示器 */}
        {loading && progressStage && (
          <div className="mb-[var(--space-4)]">
            <ProgressSteps
              currentStage={progressStage}
              stageNames={[tp("context"), tp("analyzing"), tp("generating")]}
              currentMessage={progressMessage}
            />
          </div>
        )}

        {/* 加载中（无内容且无进度时显示骨架） */}
        {loading && !content && !progressStage && (
          <div className="flex items-center gap-[var(--space-2)] text-[var(--muted)]">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-[length:var(--text-sm)]">{t("loading")}</span>
          </div>
        )}

        {/* 流式 markdown 渲染 */}
        {content && !hasError && (
          <div className="break-words text-[length:var(--text-sm)] text-[var(--fg-2)] [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_h1]:mt-[var(--space-4)] [&_h1]:mb-[var(--space-2)] [&_h1]:text-[length:var(--text-lg)] [&_h1]:font-[weight:var(--weight-semibold)] [&_h1]:text-[var(--fg)] [&_h2]:mt-[var(--space-4)] [&_h2]:mb-[var(--space-2)] [&_h2]:text-[length:var(--text-md)] [&_h2]:font-[weight:var(--weight-semibold)] [&_h2]:text-[var(--fg)] [&_h3]:mt-[var(--space-3)] [&_h3]:mb-[var(--space-1)] [&_h3]:font-[weight:var(--weight-medium)] [&_h3]:text-[var(--fg)] [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:rounded-[var(--radius-sm)] [&_code]:bg-[var(--surface-2)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[length:var(--text-xs)] [&_pre]:rounded-[var(--radius-md)] [&_pre]:bg-[var(--surface-2)] [&_pre]:p-[var(--space-3)] [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-[var(--space-3)] [&_blockquote]:text-[var(--muted)]">
            <Markdown source={content} />
            {loading && (
              <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-[var(--accent)] align-middle" />
            )}
          </div>
        )}

        {/* AI 结果反馈按钮 */}
        {content && !hasError && !loading && (
          <FeedbackButtons
            capability="project-insight"
            workspaceId={wid}
            originalOutput={content}
          />
        )}
      </div>

      {/* 底部操作栏：周报模式下显示保存按钮 */}
      {canSave && (
        <footer className="flex items-center justify-end gap-[var(--space-2)] border-t border-[var(--border)] px-[var(--space-5)] py-[var(--space-3)]">
          {saveStatus === "saved" && (
            <span className="text-[length:var(--text-sm)] text-[var(--success)]">
              {t("saved")}
            </span>
          )}
          {saveStatus === "error" && (
            <span className="text-[length:var(--text-sm)] text-[var(--danger)]">
              {t("saveFailed")}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === "saving"}
            className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {saveStatus === "saving" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saveStatus === "saving" ? t("saving") : t("saveAsDoc")}
          </button>
        </footer>
      )}
    </div>
  );
}