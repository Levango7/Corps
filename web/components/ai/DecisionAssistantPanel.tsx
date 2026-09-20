"use client";

/**
 * AI 决策辅助面板组件（W3-A 决策辅助增强）。
 *
 * 功能：
 *  - 输入决策问题（如"应该选 A 方案还是 B 方案"）+ 可选补充背景
 *  - 点击分析按钮 → 调用 POST /api/v1/ai/decision-assistant
 *  - AI 基于工作区上下文（任务、决策历史、项目进度）进行多维度分析：
 *    · 展示可选方案卡片（标题、描述、优势、劣势、风险）
 *    · 推荐方案高亮 + 推荐理由
 *    · 历史决策参考列表
 *
 * 样式全走 design token（var(--*)），lucide-react 图标尺寸 14/16。
 * 错误处理：catch 中用 t("error")，不泄露 e.message。
 *
 * i18n：useTranslations("ai.decisionAssistant")，引用但不修改 zh.json/en.json。
 * key 暂未在 messages 文件中定义时，tf helper 回退到内置英文默认值，
 * 保证组件在 key 缺失时仍正常渲染（不抛 IntlError）。
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Lightbulb,
  Loader2,
  Sparkles,
  AlertCircle,
  X,
  Check,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  History,
  Award,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";

// ── 类型定义 ──

/** AI 生成的可选方案 */
interface DecisionOption {
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  risks: string[];
}

/** AI 生成的推荐方案 */
interface Recommendation {
  optionIndex: number;
  reason: string;
}

/** AI 生成的历史决策参考 */
interface HistoricalRef {
  title: string;
  outcome: string;
}

/** 决策辅助完整结果 */
interface DecisionAssistantResult {
  options: DecisionOption[];
  recommendation: Recommendation;
  historicalRefs: HistoricalRef[];
}


// ── 样式常量 ──

/** 输入框样式（design token） */
const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

/** 主按钮样式 */
const primaryBtn =
  "inline-flex items-center gap-1.5 h-9 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

// ── 组件 Props ──

interface DecisionAssistantPanelProps {
  /** 工作区 ID */
  wid: string;
}

// ── 组件实现 ──

export default function DecisionAssistantPanel({
  wid,
}: DecisionAssistantPanelProps) {
  const t = useTranslations("ai.decisionAssistant");
  const { toast } = useToast();


  // ── 状态 ──

  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DecisionAssistantResult | null>(null);

  // ── 分析决策 ──

  const handleAnalyze = useCallback(async () => {
    if (analyzing || !question.trim()) return;
    setAnalyzing(true);
    setError("");
    try {
      const data = await api<DecisionAssistantResult>(
        "/api/v1/ai/decision-assistant",
        {
          method: "POST",
          body: JSON.stringify({
            wid,
            question: question.trim(),
            context: context.trim() || undefined,
          }),
        },
      );
      setResult(data);
      if (data.options.length === 0) {
        toast("warning", t("noResults"));
      }
    } catch (e) {
      if (process.env.NODE_ENV === "development")
        console.error("[DecisionAssistantPanel] analyze error:", e);
      const msg = e instanceof ApiError ? e.message : t("analyzeFailed");
      setError(msg);
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, question, context, wid, toast]);

  // ── 推荐方案索引 ──
  const recommendedIndex = result?.recommendation.optionIndex ?? -1;

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("title")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Lightbulb size={16} className="text-[var(--accent)]" />
          {t("title")}
        </h2>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-3)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
              aria-label="close"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* 决策问题输入区 */}
        <div className="space-y-2">
          <label
            className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]"
            htmlFor="decision-question"
          >
            {t("questionLabel")}
          </label>
          <textarea
            id="decision-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("questionPlaceholder")}
            maxLength={2000}
            rows={3}
            disabled={analyzing}
            className={`${fieldControl} resize-y min-h-[80px] leading-relaxed disabled:opacity-60`}
            aria-label={t("questionLabel")}
          />
          {/* 补充背景（可选） */}
          <label
            className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--meta)]"
            htmlFor="decision-context"
          >
            {t("contextLabel")}
          </label>
          <input
            id="decision-context"
            type="text"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder={t("contextPlaceholder")}
            maxLength={2000}
            disabled={analyzing}
            className={`${fieldControl} disabled:opacity-60`}
            aria-label={t("contextLabel")}
          />
          {/* 分析按钮 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || !question.trim()}
              className={primaryBtn}
            >
              {analyzing ? (
                <Loader2 size={16} className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Sparkles size={16} />
              )}
              {analyzing ? t("analyzing") : t("analyze")}
            </button>
            {!question.trim() && (
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {t("noQuestion")}
              </span>
            )}
          </div>
        </div>

        {/* 加载态 */}
        {analyzing && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2
              size={16}
              className="animate-spin mr-2 motion-reduce:animate-none"
            />
            {t("analyzing")}
          </div>
        )}

        {/* 空态 */}
        {!analyzing && !result && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <Lightbulb size={32} className="opacity-40" />
            <p>{t("emptyHint")}</p>
          </div>
        )}

        {/* 分析结果 */}
        {!analyzing && result && (
          <div className="space-y-[var(--space-4)]">
            {/* 可选方案 */}
            {result.options.length > 0 && (
              <div className="space-y-[var(--space-2)]">
                <h3 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                  <Sparkles size={14} className="text-[var(--accent)]" />
                  {t("options")}
                </h3>
                <div className="space-y-[var(--space-3)]">
                  {result.options.map((option, index) => {
                    const isRecommended = index === recommendedIndex;
                    return (
                      <div
                        key={`option-${index}`}
                        className={`rounded-[var(--radius-md)] border p-[var(--space-3)] space-y-[var(--space-2)] ${
                          isRecommended
                            ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[var(--elev-sm)]"
                            : "border-[var(--border)] bg-[var(--surface-2)]"
                        }`}
                      >
                        {/* 方案标题 */}
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                            <span className="text-[var(--meta)]">
                              {t("optionLabel")} {index + 1}
                            </span>
                            {option.title}
                          </h4>
                          {isRecommended && (
                            <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-1.5 py-0.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--accent-fg)]">
                              <Award size={14} />
                              {t("recommended")}
                            </span>
                          )}
                        </div>
                        {/* 方案描述 */}
                        {option.description && (
                          <p className="text-[length:var(--text-sm)] leading-relaxed text-[var(--fg-2)]">
                            {option.description}
                          </p>
                        )}
                        {/* 优势 */}
                        {option.pros.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--accent-fg)]">
                              <ThumbsUp size={14} />
                              {t("pros")}
                            </div>
                            <ul className="space-y-0.5 pl-5">
                              {option.pros.map((pro, i) => (
                                <li
                                  key={`pro-${i}`}
                                  className="flex items-start gap-1 text-[length:var(--text-xs)] text-[var(--fg-2)]"
                                >
                                  <Check
                                    size={14}
                                    className="shrink-0 mt-0.5 text-[var(--accent)]"
                                  />
                                  <span className="flex-1">{pro}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* 劣势 */}
                        {option.cons.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]">
                              <ThumbsDown size={14} />
                              {t("cons")}
                            </div>
                            <ul className="space-y-0.5 pl-5">
                              {option.cons.map((con, i) => (
                                <li
                                  key={`con-${i}`}
                                  className="flex items-start gap-1 text-[length:var(--text-xs)] text-[var(--fg-2)]"
                                >
                                  <X
                                    size={14}
                                    className="shrink-0 mt-0.5 text-[var(--meta)]"
                                  />
                                  <span className="flex-1">{con}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* 风险 */}
                        {option.risks.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--danger-fg)]">
                              <AlertTriangle size={14} />
                              {t("risks")}
                            </div>
                            <ul className="space-y-0.5 pl-5">
                              {option.risks.map((risk, i) => (
                                <li
                                  key={`risk-${i}`}
                                  className="flex items-start gap-1 text-[length:var(--text-xs)] text-[var(--fg-2)]"
                                >
                                  <AlertTriangle
                                    size={14}
                                    className="shrink-0 mt-0.5 text-[var(--danger)]"
                                  />
                                  <span className="flex-1">{risk}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 推荐理由 */}
            {result.recommendation.reason && (
              <div className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent-soft)] p-[var(--space-3)] space-y-1">
                <div className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--accent-fg)]">
                  <Award size={16} />
                  {t("recommendationReason")}
                </div>
                <p className="text-[length:var(--text-sm)] leading-relaxed text-[var(--fg)]">
                  {result.recommendation.reason}
                </p>
              </div>
            )}

            {/* 历史参考 */}
            <div className="space-y-[var(--space-2)]">
              <h3 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                <History size={14} className="text-[var(--accent)]" />
                {t("historicalRefs")}
              </h3>
              {result.historicalRefs.length === 0 ? (
                <p className="text-[length:var(--text-xs)] text-[var(--meta)] py-2">
                  {t("noHistoricalRefs")}
                </p>
              ) : (
                <ul className="space-y-[var(--space-2)]">
                  {result.historicalRefs.map((ref, index) => (
                    <li
                      key={`ref-${index}`}
                      className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-[var(--space-2)] space-y-0.5"
                    >
                      <div className="flex items-center gap-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                        <History size={14} className="text-[var(--meta)]" />
                        {ref.title}
                      </div>
                      {ref.outcome && (
                        <p className="text-[length:var(--text-xs)] leading-relaxed text-[var(--fg-2)] pl-5">
                          {ref.outcome}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}