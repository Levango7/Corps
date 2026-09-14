"use client";

/**
 * IM 智能回复建议组件。
 *
 * 调用 POST /api/v1/ai/im-reply（deepseek-chat）分析最近聊天上下文，
 * 展示 3 个不同风格的回复建议卡片：
 *  - 每个卡片含回复文本 + tone 标签（正式/随意/简洁）
 *  - 点击卡片或复制按钮触发 onSelect(text) 回调
 *  - 复制按钮额外将文本写入剪贴板
 *
 * 组件加载时自动调用 API，失败可点击"重试"重新生成。
 *
 * Design token 颜色映射：
 *  - formal  → var(--accent) / var(--accent-soft)
 *  - casual  → var(--success) / var(--success-soft)
 *  - concise → var(--muted)   / var(--surface-3)
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** AI 回复建议响应结构（与后端 data 字段一致） */
interface ImReplySuggestion {
  text: string;
  tone: "formal" | "casual" | "concise";
}

interface ImReplySuggestionsProps {
  wid: string;
  conversationId?: string;
  taskId?: string;
  messageId?: string;
  /** 点击回复建议时回调，通常将文本填入输入框 */
  onSelect: (text: string) => void;
}

/** tone → 颜色 token + i18n key */
function getToneVisual(tone: ImReplySuggestion["tone"]) {
  switch (tone) {
    case "formal":
      return {
        color: "var(--accent)",
        bg: "var(--accent-soft)",
        labelKey: "formal",
      };
    case "casual":
      return {
        color: "var(--success)",
        bg: "var(--success-soft)",
        labelKey: "casual",
      };
    case "concise":
      return {
        color: "var(--muted)",
        bg: "var(--surface-3)",
        labelKey: "concise",
      };
  }
}

export function ImReplySuggestions({
  wid,
  conversationId,
  taskId,
  messageId,
  onSelect,
}: ImReplySuggestionsProps) {
  const t = useTranslations("ai.imReply");

  const [suggestions, setSuggestions] = useState<ImReplySuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // cancelled 标志：组件卸载或依赖变化时置 true，generate 内每次 setState 前检查，
  // 避免在已卸载组件上触发 setState（React 警告）。
  const cancelledRef = useRef(false);

  // AbortController：组件卸载或依赖变化时中止进行中的 fetch 请求，
  // 避免请求继续消耗带宽与后端资源。
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const abortRef = useRef<AbortController | null>(null);

  // 复制按钮 timer id：组件卸载时清理，避免 setTimeout 在已卸载组件上触发 setState（React 警告）。
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generate = async () => {
    if (cancelledRef.current) return;
    // 中止之前未完成的请求，避免并发请求互相覆盖
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(false);
    try {
      const data = await api<ImReplySuggestion[]>("/api/v1/ai/im-reply", {
        method: "POST",
        body: JSON.stringify({
          wid,
          conversationId,
          taskId,
          messageId,
        }),
        signal: ac.signal,
      });
      if (cancelledRef.current || ac.signal.aborted) return;
      setSuggestions(Array.isArray(data) ? data : []);
    } catch (e) {
      if (cancelledRef.current || ac.signal.aborted) return;
      // AbortError 是主动中止，不显示错误状态
      if (e instanceof Error && e.name === "AbortError") return;
      // 503（AI 未配置）/ 500 / 网络错误均显示错误态
      setError(true);
      // 仅在开发环境输出错误日志，避免生产环境噪音
      // 来源：经验 2026-09-12-svg-chart-text-attribute-i18n-token-audit-checklist
      if (process.env.NODE_ENV === "development" && (e instanceof ApiError || e instanceof Error)) {
        console.error("[ImReplySuggestions] error:", e.message);
      }
    } finally {
      if (cancelledRef.current || ac.signal.aborted) return;
      setLoading(false);
    }
  };

  // 组件加载时自动调用 API；卸载或依赖变化时标记 cancelled、中止请求并清理复制 timer
  useEffect(() => {
    cancelledRef.current = false;
    void generate();
    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
      // 清理复制按钮 timer，避免卸载后触发 setState
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, conversationId, taskId, messageId]);

  /** 复制文本到剪贴板并触发 onSelect */
  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板 API 不可用时静默降级，仍触发 onSelect
    }
    setCopiedIndex(index);
    onSelect(text);
    // 2 秒后恢复复制按钮图标；清理上一个 timer 避免重叠
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(
      () => setCopiedIndex((prev) => (prev === index ? null : prev)),
      2000,
    );
  };

  // —— Loading ——
  if (loading) {
    return (
      <aside
        className="flex w-full flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
        aria-label={t("title")}
      >
        <header className="flex items-center gap-[var(--space-2)]">
          <Sparkles size={14} className="shrink-0 text-[var(--accent)]" />
          <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h2>
        </header>
        <div className="flex items-center justify-center gap-[var(--space-2)] py-[var(--space-4)]">
          <Loader2 size={14} className="shrink-0 animate-spin text-[var(--muted)]" />
          <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("loading")}
          </span>
        </div>
      </aside>
    );
  }

  // —— Error ——
  if (error) {
    return (
      <aside
        className="flex w-full flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
        aria-label={t("title")}
      >
        <header className="flex items-center gap-[var(--space-2)]">
          <Sparkles size={14} className="shrink-0 text-[var(--accent)]" />
          <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h2>
        </header>
        <div className="flex flex-col items-center gap-[var(--space-3)] py-[var(--space-3)]">
          <p className="text-[length:var(--text-xs)] text-[var(--danger)]">
            {t("error")}
          </p>
          <button
            type="button"
            onClick={() => void generate()}
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <RefreshCw size={14} className="shrink-0" />
            {t("retry")}
          </button>
        </div>
      </aside>
    );
  }

  // —— Empty ——
  if (suggestions.length === 0) {
    return (
      <aside
        className="flex w-full flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
        aria-label={t("title")}
      >
        <header className="flex items-center gap-[var(--space-2)]">
          <Sparkles size={14} className="shrink-0 text-[var(--accent)]" />
          <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("title")}
          </h2>
        </header>
        <p className="py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
          {t("noSuggestions")}
        </p>
      </aside>
    );
  }

  // —— Result ——
  return (
    <aside
      className="flex w-full flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
      aria-label={t("title")}
    >
      {/* 标题 */}
      <header className="flex items-center gap-[var(--space-2)]">
        <Sparkles size={14} className="shrink-0 text-[var(--accent)]" />
        <h2 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("title")}
        </h2>
      </header>

      {/* 回复建议卡片 */}
      <ul className="flex flex-col gap-[var(--space-2)]">
        {suggestions.map((s, i) => {
          const tone = getToneVisual(s.tone);
          const isCopied = copiedIndex === i;
          return (
            <li key={`${s.text}_${i}`}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(s.text)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(s.text);
                  }
                }}
                className="group flex cursor-pointer flex-col gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)] transition-colors duration-[var(--motion-fast)] hover:border-[var(--accent-ring)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                {/* tone 标签 + 复制按钮 */}
                <div className="flex items-center justify-between">
                  <span
                    className="inline-flex items-center rounded-[var(--radius-sm)] px-[var(--space-2)] py-[0.125rem] text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)]"
                    style={{ color: tone.color, backgroundColor: tone.bg }}
                  >
                    {t(tone.labelKey)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCopy(s.text, i);
                    }}
                    aria-label={isCopied ? t("copied") : t("copy")}
                    className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-1)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  >
                    {isCopied ? (
                      <Check size={14} className="shrink-0 text-[var(--success)]" />
                    ) : (
                      <Copy size={14} className="shrink-0" />
                    )}
                    <span className="sr-only">
                      {isCopied ? t("copied") : t("copy")}
                    </span>
                  </button>
                </div>
                {/* 回复文本 */}
                <p className="break-words text-[length:var(--text-sm)] leading-relaxed text-[var(--fg-2)]">
                  {s.text}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export default ImReplySuggestions;