"use client";

/**
 * AI 审批风控建议面板。
 *
 * 调用 POST /api/v1/ai/approval-advice（deepseek-reasoner）分析当前审批实例，
 * 展示：
 *  - 风险等级（low/medium/high，颜色标识）
 *  - 风险因素列表（每条带 AlertTriangle 图标）
 *  - AI 建议文字
 *  - 相似历史案例列表
 *
 * 面板加载时自动调用 API，失败可点击"重试"重新分析。
 *
 * Design token 颜色映射（先 grep 确认可用 token 后按语义降级）：
 *  - low    → var(--success)      ✓ 存在
 *  - medium → var(--status-warn)  ✓ 存在（= var(--warn)）
 *  - high   → var(--status-error) ✗ 不存在 → 降级为 var(--danger)
 *    来源：经验 2026-09-11-design-token-missing-semantic-fallback
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { consumeAiProgressStream, type AiProgressPart } from "@/components/editor/aiStream";
import { ProgressSteps, type ProgressStage } from "@/components/ai/ProgressSteps";
import { FeedbackButtons } from "./FeedbackButtons";

/** AI 风控建议响应结构（与后端 data 字段一致） */
interface ApprovalAdvice {
  riskLevel: "low" | "medium" | "high";
  riskFactors: string[];
  suggestion: string;
  similarCases: {
    title: string;
    result: "approved" | "rejected";
    amount: number;
  }[];
}

interface ApprovalAdvicePanelProps {
  wid: string;
  approvalInstanceId: string;
}

/** 风险等级 → 图标 + 颜色 token + i18n key */
function getRiskVisual(riskLevel: ApprovalAdvice["riskLevel"]) {
  switch (riskLevel) {
    case "low":
      return {
        icon: <CheckCircle2 size={14} className="shrink-0" />,
        color: "var(--success)",
        bg: "var(--success-soft)",
        labelKey: "riskLow",
      };
    case "medium":
      return {
        icon: <AlertTriangle size={14} className="shrink-0" />,
        color: "var(--status-warn)",
        bg: "var(--warn-soft)",
        labelKey: "riskMedium",
      };
    case "high":
      return {
        icon: <XCircle size={14} className="shrink-0" />,
        // --status-error 不存在，降级为 --danger（语义最接近的红色）
        // 来源：经验 2026-09-11-design-token-missing-semantic-fallback
        color: "var(--danger)",
        bg: "var(--danger-soft)",
        labelKey: "riskHigh",
      };
  }
}

export function ApprovalAdvicePanel({
  wid,
  approvalInstanceId,
}: ApprovalAdvicePanelProps) {
  const t = useTranslations("ai.approvalAdvice");
  const tp = useTranslations("ai.progress");

  const [advice, setAdvice] = useState<ApprovalAdvice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 进度状态：当前阶段 + 阶段消息
  const [progressStage, setProgressStage] = useState<ProgressStage | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>("");

  // cancelled 标志：组件卸载或依赖变化时置 true，analyze 内每次 setState 前检查，
  // 避免在已卸载组件上触发 setState（React 警告）。
  // 用 ref 而非 useEffect 内局部变量，是为了让重试按钮仍能调用同一个 analyze。
  const cancelledRef = useRef(false);

  // AbortController：组件卸载或依赖变化时中止进行中的 fetch 请求，
  // 避免请求继续消耗带宽与后端资源（与 DailyReportView/ProjectInsightView 一致）。
  // 来源：经验 2026-09-13-abortcontroller-null-access-after-abort-runtime-crash
  const abortRef = useRef<AbortController | null>(null);

  const analyze = async () => {
    if (cancelledRef.current) return;
    // 中止之前未完成的请求，避免并发请求互相覆盖
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(false);
    setAdvice(null);
    setProgressStage(null);
    setProgressMessage("");
    try {
      const { data } = await consumeAiProgressStream(
        "/api/v1/ai/approval-advice",
        { wid, approvalInstanceId },
        {
          signal: controller.signal,
          onProgress: (progress: AiProgressPart) => {
            if (cancelledRef.current || controller.signal.aborted) return;
            setProgressStage(progress.stage);
            setProgressMessage(progress.message);
          },
          onData: (result) => {
            if (cancelledRef.current || controller.signal.aborted) return;
            setAdvice(result as ApprovalAdvice);
          },
        },
      );
      if (cancelledRef.current || controller.signal.aborted) return;
      // data-result data part 已通过 onData 设置 advice，无需后备检查
      // （旧代码 `if (data && !advice)` 中 advice 是闭包陈旧值恒为 null，无效）
      void data;
    } catch (e) {
      if (cancelledRef.current || controller.signal.aborted) return;
      // AbortError 是主动中止，不显示错误状态
      if (e instanceof Error && e.name === "AbortError") return;
      // 流错误（如审批实例不存在、AI 服务不可用）均显示错误状态
      setError(true);
      if (e instanceof Error) {
        // 仅在开发环境输出错误日志，避免生产环境噪音
        if (process.env.NODE_ENV === "development") {
          console.error("[ApprovalAdvicePanel] error:", e.message);
        }
      }
    } finally {
      if (!cancelledRef.current && !controller.signal.aborted) {
        setLoading(false);
        setProgressStage(null);
      }
    }
  };

  // 面板加载时自动调用 API；卸载或依赖变化时标记 cancelled 并中止进行中的请求
  useEffect(() => {
    cancelledRef.current = false;
    void analyze();
    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, approvalInstanceId]);

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
        {progressStage ? (
          <ProgressSteps
            currentStage={progressStage}
            stageNames={[tp("context"), tp("analyzing"), tp("generating")]}
            currentMessage={progressMessage}
          />
        ) : (
          <div className="flex items-center justify-center gap-[var(--space-2)] py-[var(--space-4)]">
            <Loader2
              size={14}
              className="shrink-0 animate-spin text-[var(--muted)]"
            />
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("analyzing")}
            </span>
          </div>
        )}
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
            onClick={() => void analyze()}
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            {t("retry")}
          </button>
        </div>
      </aside>
    );
  }

  // —— Result ——
  if (!advice) return null;

  const risk = getRiskVisual(advice.riskLevel);

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

      {/* 风险等级 */}
      <div
        className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)]"
        style={{ backgroundColor: risk.bg }}
      >
        <span style={{ color: risk.color }}>{risk.icon}</span>
        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
          {t("riskLevel")}
        </span>
        <span
          className="ml-auto text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)]"
          style={{ color: risk.color }}
        >
          {t(risk.labelKey)}
        </span>
      </div>

      {/* 风险因素 */}
      <div className="flex flex-col gap-[var(--space-1)]">
        <h3 className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--muted)]">
          {t("riskFactors")}
        </h3>
        {advice.riskFactors.length > 0 ? (
          <ul className="flex flex-col gap-[var(--space-1)]">
            {advice.riskFactors.map((factor, idx) => (
              <li
                key={`${factor}_${idx}`}
                className="flex items-start gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--fg-2)]"
              >
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0 text-[var(--warn)]"
                />
                <span className="break-words">{factor}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("noRiskFactors")}
          </p>
        )}
      </div>

      {/* AI 建议 */}
      {advice.suggestion && (
        <div className="flex flex-col gap-[var(--space-1)]">
          <h3 className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--muted)]">
            {t("suggestion")}
          </h3>
          <p className="break-words text-[length:var(--text-xs)] leading-relaxed text-[var(--fg-2)]">
            {advice.suggestion}
          </p>
        </div>
      )}

      {/* 相似历史案例 */}
      <div className="flex flex-col gap-[var(--space-1)]">
        <h3 className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--muted)]">
          {t("similarCases")}
        </h3>
        {advice.similarCases.length > 0 ? (
          <ul className="flex flex-col gap-[var(--space-1)]">
            {advice.similarCases.map((c, idx) => (
              <li
                key={`${c.title}_${idx}`}
                className="flex items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--fg-2)]"
              >
                {c.result === "approved" ? (
                  <CheckCircle2
                    size={14}
                    className="shrink-0 text-[var(--success)]"
                  />
                ) : (
                  <XCircle
                    size={14}
                    className="shrink-0 text-[var(--danger)]"
                  />
                )}
                <span className="break-words">{c.title}</span>
                {c.amount > 0 && (
                  <span className="ml-auto shrink-0 text-[var(--meta)]">
                    ¥{c.amount}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("noSimilarCases")}
          </p>
        )}
      </div>

      {/* AI 结果反馈按钮 */}
      <FeedbackButtons
        capability="approval-advice"
        workspaceId={wid}
        originalOutput={advice}
      />
    </aside>
  );
}

export default ApprovalAdvicePanel;