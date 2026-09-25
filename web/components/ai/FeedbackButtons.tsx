"use client";

/**
 * AI 结果反馈按钮组件（方向 D）。
 *
 * 功能：
 *  - 显示点赞/点踩两个按钮
 *  - 点击点赞：直接提交 positive 反馈，按钮高亮
 *  - 点击点踩：弹出修正反馈对话框（textarea + 提交），用户可输入修正建议
 *  - 提交后按钮变为已反馈状态（禁用）
 *  - AbortController 支持取消（组件卸载或重新提交时中止进行中的请求）
 *  - 错误处理：fetch 失败时显示错误提示，不泄露 error.message
 *
 * Design token 颜色映射：
 *  - positive 高亮 → var(--success)
 *  - negative 高亮 → var(--danger)
 *  - 默认边框/文字 → var(--border) / var(--muted)
 */

import { useEffect, useRef, useState } from "react";
import { ThumbsUp, ThumbsDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

/** 反馈评分类型 */
type Rating = "positive" | "negative";

interface FeedbackButtonsProps {
  /** AI 能力标识（如 "task-breakdown"） */
  capability: string;
  /** 工作区 ID */
  workspaceId: string;
  /** 原始 AI 输出（随反馈一起提交，用于后续分析） */
  originalOutput?: unknown;
  /** 反馈提交成功后的回调 */
  onFeedbackSubmitted?: (rating: Rating) => void;
}

export function FeedbackButtons({
  capability,
  workspaceId,
  originalOutput,
  onFeedbackSubmitted,
}: FeedbackButtonsProps) {
  const t = useTranslations("ai.feedback");

  // 已提交的反馈类型（提交后禁用按钮）
  const [submitted, setSubmitted] = useState<Rating | null>(null);
  // 是否显示点踩修正对话框
  const [showDialog, setShowDialog] = useState(false);
  // 修正建议文本
  const [comment, setComment] = useState("");
  // 提交中状态
  const [submitting, setSubmitting] = useState(false);
  // 错误提示（不泄露 error.message，仅显示 i18n 文案）
  const [error, setError] = useState(false);

  // AbortController：组件卸载或重新提交时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);
  // 修正建议 textarea 引用，用于对话框打开时自动聚焦
  const commentRef = useRef<HTMLTextAreaElement>(null);

  // 组件卸载时中止进行中的请求
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // 对话框打开时自动聚焦 textarea
  useEffect(() => {
    if (showDialog) {
      commentRef.current?.focus();
    }
  }, [showDialog]);

  // 对话框打开时按 Escape 键关闭
  useEffect(() => {
    if (!showDialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // handleCancel 是组件内闭包，依赖 comment/error 状态；此处仅依赖 showDialog
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDialog]);

  /** 提交反馈到后端 */
  const submit = async (rating: Rating, correctedComment?: string) => {
    // 中止之前未完成的请求
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setSubmitting(true);
    setError(false);
    try {
      await api("/api/v1/ai/feedback", {
        method: "POST",
        body: JSON.stringify({
          workspaceId,
          capability,
          rating,
          comment: correctedComment || undefined,
          originalOutput,
        }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setSubmitted(rating);
      onFeedbackSubmitted?.(rating);
    } catch (e) {
      if (ac.signal.aborted) return;
      // AbortError 是主动中止，不显示错误
      if (e instanceof Error && e.name === "AbortError") return;
      // 其他错误显示 i18n 错误提示，不泄露 error.message
      setError(true);
    } finally {
      if (!ac.signal.aborted) {
        setSubmitting(false);
      }
    }
  };

  /** 点击点赞：直接提交 positive */
  const handleLike = () => {
    if (submitted || submitting) return;
    void submit("positive");
  };

  /** 点击点踩：弹出修正对话框 */
  const handleDislike = () => {
    if (submitted || submitting) return;
    setShowDialog(true);
  };

  /** 提交点踩反馈（带修正建议） */
  const handleDislikeSubmit = () => {
    if (submitting) return;
    void submit("negative", comment).then(() => {
      // 提交成功后关闭对话框
      setShowDialog(false);
      setComment("");
    });
  };

  /** 取消点踩对话框 */
  const handleCancel = () => {
    setShowDialog(false);
    setComment("");
    setError(false);
  };

  // —— 渲染 ——
  return (
    <div className="relative inline-flex items-center gap-[var(--space-1)]">
      {/* 点赞按钮 */}
      <button
        type="button"
        onClick={handleLike}
        disabled={submitted !== null || submitting}
        aria-label={t("like")}
        aria-pressed={submitted === "positive"}
        className={`inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed ${
          submitted === "positive"
            ? "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]"
            : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
        }`}
      >
        <ThumbsUp size={16} className="shrink-0" />
        <span>{t("like")}</span>
      </button>

      {/* 点踩按钮 */}
      <button
        type="button"
        onClick={handleDislike}
        disabled={submitted !== null || submitting}
        aria-label={t("dislike")}
        aria-pressed={submitted === "negative"}
        className={`inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-xs)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:cursor-not-allowed ${
          submitted === "negative"
            ? "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]"
            : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
        }`}
      >
        <ThumbsDown size={16} className="shrink-0" />
        <span>{t("dislike")}</span>
      </button>

      {/* 已提交提示 */}
      {submitted && !showDialog && (
        <span className="ml-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--success)]">
          {t("submitted")}
        </span>
      )}

      {/* 错误提示（不泄露 error.message） */}
      {error && !showDialog && (
        <span className="ml-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--danger)]">
          {t("error")}
        </span>
      )}

      {/* 点踩修正对话框 */}
      {showDialog && (
        <>
          {/* 遮罩层 */}
          <div
            className="fixed inset-0 z-40 bg-[var(--overlay)]"
            onClick={handleCancel}
            aria-hidden="true"
          />

          {/* 对话框 */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("dislike")}
            className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] shadow-[var(--elev-md)]"
          >
            {/* 关闭按钮 */}
            <button
              type="button"
              onClick={handleCancel}
              aria-label={t("cancel")}
              className="absolute right-[var(--space-3)] top-[var(--space-3)] inline-flex items-center justify-center rounded-[var(--radius-sm)] p-[var(--space-1)] text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <X size={16} className="shrink-0" />
            </button>

            {/* 标题 */}
            <h3 className="mb-[var(--space-3)] text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
              {t("dislike")}
            </h3>

            {/* 修正建议输入 */}
            <textarea
              id="feedback-comment"
              ref={commentRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("commentPlaceholder")}
              aria-label={t("commentPlaceholder")}
              rows={4}
              maxLength={5000}
              disabled={submitting}
              className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
            />

            {/* 错误提示 */}
            {error && (
              <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--danger)]">
                {t("error")}
              </p>
            )}

            {/* 操作按钮 */}
            <div className="mt-[var(--space-3)] flex justify-end gap-[var(--space-2)]">
              <button
                type="button"
                onClick={handleCancel}
                disabled={submitting}
                className="inline-flex items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleDislikeSubmit}
                disabled={submitting}
                className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--accent)] px-[var(--space-3)] py-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
              >
                {submitting ? "…" : t("submit")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default FeedbackButtons;
