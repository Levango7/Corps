"use client";

/**
 * 分享密码门（F5）：公开分享页密码保护组件。
 *
 * 功能：
 *  - 居中卡片 + 密码输入框 + 「访问」按钮
 *  - 密码错误提示 + 剩余尝试次数
 *  - 锁定状态提示（5 分钟后重试）
 *  - design token 样式（无硬编码色值）
 *  - Escape 键关闭（若提供 onClose）或清空输入
 *
 * 设计：
 *  - 全屏遮罩 + 居中卡片，与 ExportPreview 模态框同模式
 *  - 密码输入用 type=password + autocomplete=new-password，避免浏览器自动填充
 *  - 锁定状态下隐藏输入框，仅显示倒计时提示
 *  - 焦点管理：打开时聚焦输入框
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Lock, AlertTriangle, Clock } from "lucide-react";

interface SharePasswordGateProps {
  /** 是否显示密码门 */
  open: boolean;
  /** 提交密码回调（父组件负责调用验证 API 并更新 error/remainingAttempts/lockedUntil） */
  onSubmit: (password: string) => Promise<void>;
  /** 密码错误提示（null 表示无错误） */
  error?: string | null;
  /** 剩余尝试次数（undefined 表示不显示） */
  remainingAttempts?: number;
  /** 锁定截止时间（null 表示未锁定；lockedUntil > now 时显示锁定状态） */
  lockedUntil?: Date | null;
  /** 可选关闭回调；提供时 Escape 触发关闭，否则 Escape 清空输入 */
  onClose?: () => void;
}

export function SharePasswordGate({
  open,
  onSubmit,
  error,
  remainingAttempts,
  lockedUntil,
  onClose,
}: SharePasswordGateProps) {
  const t = useTranslations("shareGate");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦输入框 + Escape 处理
  useEffect(() => {
    if (!open) return;
    setPassword("");
    requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onClose) onClose();
        else setPassword("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const now = new Date();
  const isLocked = lockedUntil ? lockedUntil > now : false;
  const lockMinutesLeft = isLocked
    ? Math.max(1, Math.ceil((lockedUntil!.getTime() - now.getTime()) / 60000))
    : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || isLocked) return;
    if (!password) return;
    setSubmitting(true);
    try {
      await onSubmit(password);
      // 验证成功时父组件会关闭 open；此处不清空 password，
      // 避免关闭动画闪烁。验证失败时父组件更新 error，输入保留供用户修正。
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("dialogLabel")}
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-4"
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-[var(--space-5)] py-[var(--space-5)]">
          {/* 标题 */}
          <div className="flex items-center gap-2 mb-4">
            <Lock size={18} className="text-[var(--muted)]" />
            <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
              {t("title")}
            </h2>
          </div>

          {isLocked ? (
            /* 锁定状态：仅显示倒计时，隐藏输入 */
            <div className="flex items-start gap-2 px-3 py-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <Clock size={16} className="shrink-0 mt-0.5" />
              <span>{t("locked", { minutes: lockMinutesLeft })}</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <p className="text-[length:var(--text-sm)] text-[var(--muted)] mb-3">
                {t("description")}
              </p>
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={t("passwordPlaceholder")}
                disabled={submitting}
                className="w-full h-10 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] placeholder:text-[var(--meta)] disabled:opacity-60 transition-colors duration-[var(--motion-fast)]"
              />

              {/* 错误提示 */}
              {error && (
                <div className="mt-2 flex items-start gap-1.5 text-[length:var(--text-xs)] text-[var(--danger-fg)]">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* 剩余尝试次数：仅在出错或次数较低时提示 */}
              {typeof remainingAttempts === "number" &&
                remainingAttempts > 0 &&
                (error || remainingAttempts <= 3) && (
                  <p className="mt-2 text-[length:var(--text-xs)] text-[var(--meta)]">
                    {t("remainingAttempts", { count: remainingAttempts })}
                  </p>
                )}

              <button
                type="submit"
                disabled={submitting || !password}
                className="mt-4 w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {t("access")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default SharePasswordGate;