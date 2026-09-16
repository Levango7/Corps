"use client";

/**
 * AI 邮件助手面板。
 *
 * 调用 POST /api/v1/ai/mail-assistant，支持四种操作：
 *  - draft（起草）：流式生成专业商务邮件正文，逐字渲染 markdown
 *  - summarize（摘要）：生成要点列表格式摘要
 *  - classify（分类）：返回类别 + 置信度 + 理由（reasoner 模型）
 *  - reply（回复）：生成 3 个不同语气的回复建议卡片，点击可复制
 *
 * 交互流程：
 *  1. 顶部 4 个 tab 切换操作类型
 *  2. 内容输入 textarea（必填）+ 上下文输入 textarea（可选）
 *  3. 点击"执行"按钮发起请求
 *  4. 结果区按 action 类型分别渲染：
 *     - draft：流式 markdown 实时渲染
 *     - summarize：摘要 markdown
 *     - classify：类别标签 + 置信度进度条 + 理由文本
 *     - reply：3 个建议卡片（tone 标签 + 文本 + 复制按钮）
 *
 * Design token 颜色映射：
 *  - 类别 work     → var(--accent) / var(--accent-soft)
 *  - 类别 notice   → var(--success) / var(--success-soft)
 *  - 类别 personal → var(--status-warn) / var(--warn-soft)
 *  - 类别 urgent   → var(--danger) / var(--danger-soft)
 *  - 类别 other    → var(--muted) / var(--surface-3)
 *  - 语气 formal   → var(--accent) / var(--accent-soft)
 *  - 语气 casual   → var(--success) / var(--success-soft)
 *  - 语气 concise  → var(--muted) / var(--surface-3)
 *
 * i18n 兜底：zh.json/en.json 暂未入库 ai.mailAssistant.* 键，
 * 用 FALLBACK 字典兜底，避免显示 key 本身。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Mail,
  PenLine,
  FileText,
  Tags,
  Reply,
  Copy,
  Loader2,
  Check,
} from "lucide-react";
import Markdown from "@/components/Markdown";
import { consumeAiStream } from "@/components/editor/aiStream";
import { api, ApiError } from "@/lib/api";

// ─── 类型定义 ───

type MailAction = "draft" | "summarize" | "classify" | "reply";

type MailCategory = "work" | "notice" | "personal" | "urgent" | "other";

type MailReplyTone = "formal" | "casual" | "concise";

interface ClassifyResult {
  category: MailCategory;
  confidence: number;
  reason: string;
}

interface ReplySuggestion {
  text: string;
  tone: MailReplyTone;
}

interface MailAssistantPanelProps {
  wid: string;
}

// ─── i18n 兜底字典 ───

const FALLBACK: Record<string, string> = {
  title: "AI 邮件助手",
  actionDraft: "起草",
  actionSummarize: "摘要",
  actionClassify: "分类",
  actionReply: "回复",
  contentLabel: "邮件内容",
  contentPlaceholder: "输入邮件内容或起草需求…",
  contextLabel: "上下文（可选）",
  contextPlaceholder: "补充背景信息，如收件人关系、历史往来…",
  execute: "执行",
  generating: "生成中…",
  error: "生成失败，请重试",
  categoryWork: "工作",
  categoryNotice: "通知",
  categoryPersonal: "私人",
  categoryUrgent: "紧急",
  categoryOther: "其他",
  confidence: "置信度",
  reason: "理由",
  copy: "复制",
  copied: "已复制",
  insertResult: "插入结果",
  toneFormal: "正式",
  toneCasual: "随意",
  toneConcise: "简洁",
};

// ─── 类别 / 语气视觉映射 ───

function getCategoryVisual(category: MailCategory) {
  switch (category) {
    case "work":
      return {
        color: "var(--accent)",
        bg: "var(--accent-soft)",
        labelKey: "categoryWork",
      };
    case "notice":
      return {
        color: "var(--success)",
        bg: "var(--success-soft)",
        labelKey: "categoryNotice",
      };
    case "personal":
      return {
        color: "var(--status-warn)",
        bg: "var(--warn-soft)",
        labelKey: "categoryPersonal",
      };
    case "urgent":
      return {
        color: "var(--danger)",
        bg: "var(--danger-soft)",
        labelKey: "categoryUrgent",
      };
    case "other":
      return {
        color: "var(--muted)",
        bg: "var(--surface-3)",
        labelKey: "categoryOther",
      };
  }
}

function getToneVisual(tone: MailReplyTone) {
  switch (tone) {
    case "formal":
      return {
        color: "var(--accent)",
        bg: "var(--accent-soft)",
        labelKey: "toneFormal",
      };
    case "casual":
      return {
        color: "var(--success)",
        bg: "var(--success-soft)",
        labelKey: "toneCasual",
      };
    case "concise":
      return {
        color: "var(--muted)",
        bg: "var(--surface-3)",
        labelKey: "toneConcise",
      };
  }
}

// ─── Tab 配置 ───

const TABS: ReadonlyArray<{
  action: MailAction;
  icon: typeof Mail;
  labelKey: string;
}> = [
  { action: "draft", icon: PenLine, labelKey: "actionDraft" },
  { action: "summarize", icon: FileText, labelKey: "actionSummarize" },
  { action: "classify", icon: Tags, labelKey: "actionClassify" },
  { action: "reply", icon: Reply, labelKey: "actionReply" },
];

// ─── 组件 ───

export function MailAssistantPanel({ wid }: MailAssistantPanelProps) {
  const t = useTranslations("ai.mailAssistant");

  /** i18n 兜底：键缺失时 next-intl 返回 key 本身，改用 fallback */
  const tt = useCallback(
    (key: string): string => {
      const v = t(key);
      return v === key ? (FALLBACK[key] ?? key) : v;
    },
    [t],
  );

  const [action, setAction] = useState<MailAction>("draft");
  const [content, setContent] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 流式起草实时文本
  const [draftText, setDraftText] = useState("");

  // 摘要结果
  const [summary, setSummary] = useState("");

  // 分类结果
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);

  // 回复建议
  const [suggestions, setSuggestions] = useState<ReplySuggestion[]>([]);

  // 复制按钮状态
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // AbortController：组件卸载或重新发起请求时中止进行中的 fetch
  const abortRef = useRef<AbortController | null>(null);

  // 复制按钮 timer id：组件卸载时清理，避免 setTimeout 在已卸载组件上触发 setState
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 执行操作 */
  const handleExecute = useCallback(async () => {
    if (!content.trim() || loading) return;

    // 中止之前未完成的请求
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    // 重置结果区
    setDraftText("");
    setSummary("");
    setClassifyResult(null);
    setSuggestions([]);

    try {
      if (action === "draft") {
        // 流式起草
        const full = await consumeAiStream(
          "/api/v1/ai/mail-assistant",
          { wid, action, content, context: context.trim() || undefined },
          {
            signal: ac.signal,
            onDelta: (delta) => {
              setDraftText((prev) => prev + delta);
            },
          },
        );
        if (ac.signal.aborted) return;
        setDraftText(full);
      } else {
        // 非流式：summarize / classify / reply
        if (action === "summarize") {
          const data = await api<{ summary: string }>(
            "/api/v1/ai/mail-assistant",
            {
              method: "POST",
              body: JSON.stringify({
                wid,
                action,
                content,
                context: context.trim() || undefined,
              }),
              signal: ac.signal,
            },
          );
          if (ac.signal.aborted) return;
          setSummary(data?.summary ?? "");
        } else if (action === "classify") {
          const data = await api<ClassifyResult>(
            "/api/v1/ai/mail-assistant",
            {
              method: "POST",
              body: JSON.stringify({
                wid,
                action,
                content,
                context: context.trim() || undefined,
              }),
              signal: ac.signal,
            },
          );
          if (ac.signal.aborted) return;
          setClassifyResult(data);
        } else {
          // reply
          const data = await api<{ suggestions: ReplySuggestion[] }>(
            "/api/v1/ai/mail-assistant",
            {
              method: "POST",
              body: JSON.stringify({
                wid,
                action,
                content,
                context: context.trim() || undefined,
              }),
              signal: ac.signal,
            },
          );
          if (ac.signal.aborted) return;
          setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
        }
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      // AbortError 是主动中止，不显示错误状态
      if (e instanceof Error && e.name === "AbortError") return;
      setError(tt("error"));
      // 仅在开发环境输出错误日志，避免生产环境噪音
      if (
        process.env.NODE_ENV === "development" &&
        (e instanceof ApiError || e instanceof Error)
      ) {
        console.error("[MailAssistantPanel] error:", e.message);
      }
    } finally {
      if (ac.signal.aborted) return;
      setLoading(false);
    }
  }, [action, content, context, loading, wid, tt]);

  /** 切换 tab：重置结果区 */
  const handleTabChange = useCallback((next: MailAction) => {
    abortRef.current?.abort();
    setAction(next);
    setError(null);
    setDraftText("");
    setSummary("");
    setClassifyResult(null);
    setSuggestions([]);
  }, []);

  /** 复制回复建议到剪贴板 */
  const handleCopy = useCallback(async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板 API 不可用时静默降级
    }
    setCopiedIndex(index);
    // 2 秒后恢复复制按钮图标；清理上一个 timer 避免重叠
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(
      () => setCopiedIndex((prev) => (prev === index ? null : prev)),
      2000,
    );
  }, []);

  // 组件卸载时清理：中止进行中的请求 + 清理复制 timer，避免在已卸载组件上触发 setState
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const hasDraftResult = !loading && draftText.length > 0;
  const hasSummaryResult = !loading && summary.length > 0;
  const hasClassifyResult = !loading && classifyResult !== null;
  const hasReplyResult = !loading && suggestions.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* 顶部标题栏 */}
      <header className="flex items-center gap-[var(--space-3)] border-b border-[var(--border)] px-[var(--space-6)] py-[var(--space-4)]">
        <Mail size={16} className="shrink-0 text-[var(--accent)]" />
        <h1 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {tt("title")}
        </h1>
      </header>

      {/* Tab 切换栏 */}
      <nav
        className="flex items-center gap-[var(--space-1)] border-b border-[var(--border)] px-[var(--space-6)] py-[var(--space-2)]"
        aria-label={tt("title")}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = action === tab.action;
          return (
            <button
              key={tab.action}
              type="button"
              onClick={() => handleTabChange(tab.action)}
              aria-pressed={isActive}
              className={
                "inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] " +
                (isActive
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]")
              }
            >
              <Icon size={16} className="shrink-0" />
              {tt(tab.labelKey)}
            </button>
          );
        })}
      </nav>

      {/* 主体内容区 */}
      <div className="flex-1 overflow-y-auto px-[var(--space-6)] py-[var(--space-5)]">
        <div className="flex flex-col gap-[var(--space-4)]">
          {/* 内容输入 */}
          <div className="flex flex-col gap-[var(--space-2)]">
            <label
              htmlFor="mail-assistant-content"
              className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]"
            >
              {tt("contentLabel")}
            </label>
            <textarea
              id="mail-assistant-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={20_000}
              disabled={loading}
              placeholder={tt("contentPlaceholder")}
              className="min-h-[120px] w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] leading-[var(--leading-relaxed)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"
            />
          </div>

          {/* 上下文输入（可选） */}
          <div className="flex flex-col gap-[var(--space-2)]">
            <label
              htmlFor="mail-assistant-context"
              className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]"
            >
              {tt("contextLabel")}
            </label>
            <textarea
              id="mail-assistant-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              maxLength={5000}
              disabled={loading}
              placeholder={tt("contextPlaceholder")}
              className="min-h-[60px] w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[var(--leading-relaxed)] transition-colors duration-[var(--motion-fast)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50"
            />
          </div>

          {/* 执行按钮 */}
          <div className="flex items-center gap-[var(--space-3)]">
            <button
              type="button"
              onClick={() => void handleExecute()}
              disabled={loading || !content.trim()}
              className="inline-flex items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--on-accent)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="shrink-0 animate-spin motion-reduce:animate-none" />
                  {tt("generating")}
                </>
              ) : (
                <>
                  <Mail size={16} className="shrink-0" />
                  {tt("execute")}
                </>
              )}
            </button>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--danger)]">
              {error}
            </div>
          )}

          {/* ─── 结果展示区 ─── */}

          {/* draft：流式 markdown 渲染 */}
          {(loading || hasDraftResult) && action === "draft" && draftText.length > 0 && (
            <div className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]">
              <Markdown source={draftText} />
            </div>
          )}

          {/* summarize：摘要 markdown */}
          {hasSummaryResult && action === "summarize" && (
            <div className="flex flex-col gap-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                <FileText size={16} className="shrink-0 text-[var(--accent)]" />
                {tt("actionSummarize")}
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]">
                <Markdown source={summary} />
              </div>
            </div>
          )}

          {/* classify：类别标签 + 置信度 + 理由 */}
          {hasClassifyResult && action === "classify" && classifyResult && (
            <div className="flex flex-col gap-[var(--space-4)]">
              <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                <Tags size={16} className="shrink-0 text-[var(--accent)]" />
                {tt("actionClassify")}
              </div>

              {/* 类别标签 */}
              {(() => {
                const visual = getCategoryVisual(classifyResult.category);
                return (
                  <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                    <span
                      className="inline-flex items-center rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)]"
                      style={{ color: visual.color, backgroundColor: visual.bg }}
                    >
                      {tt(visual.labelKey)}
                    </span>

                    {/* 置信度进度条 */}
                    <div className="flex items-center gap-[var(--space-2)]">
                      <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                        {tt("confidence")}
                      </span>
                      <div
                        className="h-[6px] w-[120px] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-3)]"
                        role="progressbar"
                        aria-valuenow={Math.round(classifyResult.confidence * 100)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="h-full rounded-[var(--radius-sm)] bg-[var(--accent)] transition-all duration-[var(--motion-fast)]"
                          style={{
                            width: `${Math.round(classifyResult.confidence * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                        {Math.round(classifyResult.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* 理由 */}
              {classifyResult.reason && (
                <div className="flex flex-col gap-[var(--space-2)]">
                  <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--meta)]">
                    {tt("reason")}
                  </span>
                  <p className="break-words text-[length:var(--text-sm)] leading-relaxed text-[var(--fg-2)]">
                    {classifyResult.reason}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* reply：3 个回复建议卡片 */}
          {hasReplyResult && action === "reply" && (
            <div className="flex flex-col gap-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                <Reply size={16} className="shrink-0 text-[var(--accent)]" />
                {tt("actionReply")}
              </div>

              {suggestions.length === 0 ? (
                <p className="py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--meta)]">
                  {tt("error")}
                </p>
              ) : (
                <ul className="flex flex-col gap-[var(--space-2)]">
                  {suggestions.map((s, i) => {
                    const tone = getToneVisual(s.tone);
                    const isCopied = copiedIndex === i;
                    return (
                      <li key={`${s.text}_${i}`}>
                        <div className="group flex flex-col gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-3)] transition-colors duration-[var(--motion-fast)] hover:border-[var(--accent-ring)] hover:bg-[var(--surface-3)]">
                          {/* tone 标签 + 复制按钮 */}
                          <div className="flex items-center justify-between">
                            <span
                              className="inline-flex items-center rounded-[var(--radius-sm)] px-[var(--space-2)] py-[0.125rem] text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)]"
                              style={{ color: tone.color, backgroundColor: tone.bg }}
                            >
                              {tt(tone.labelKey)}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleCopy(s.text, i);
                              }}
                              aria-label={isCopied ? tt("copied") : tt("copy")}
                              className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-1)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                            >
                              {isCopied ? (
                                <Check size={16} className="shrink-0 text-[var(--success)]" />
                              ) : (
                                <Copy size={16} className="shrink-0" />
                              )}
                              <span className="sr-only">
                                {isCopied ? tt("copied") : tt("copy")}
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


export default MailAssistantPanel;