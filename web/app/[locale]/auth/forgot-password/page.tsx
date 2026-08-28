"use client";

import { useState, type FormEvent } from "react";
import { Link } from "@/lib/i18n-navigation";
import { Loader2, AlertCircle, MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * 忘记密码页：请求重置链接。
 * 走 Better Auth 内置端点 /api/auth/request-password-reset（token 生成与一次性校验
 * 由 better-auth 托管，见 lib/auth.ts sendResetPassword 配置）。
 * 无论邮箱是否存在均返回相同响应（better-auth 内置防枚举），前端统一展示成功文案。
 */
export default function ForgotPasswordPage() {
  const t = useTranslations("auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      // redirectTo 参与 better-auth 生成的默认链接构造；本项目的重置页链接
      // 由服务端回调自建（/auth/reset-password），此字段仅用于通过端点校验
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/auth/reset-password`,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message || t("failed"));
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm px-4 sm:px-0">
      <div className="mb-[var(--space-5)] sm:mb-8">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          {t("title")}
        </h1>
        <p className="mt-1.5 text-[length:var(--text-sm)] sm:text-[length:var(--text-base)] text-[var(--muted)]">
          {t("subtitle")}
        </p>
      </div>

      <div className="bg-[var(--surface)] rounded-[var(--radius-lg)] p-4 sm:p-8 shadow-[var(--elev-sm)] border border-[var(--border)]">
        {sent ? (
          <div className="space-y-4">
            <div className="flex items-start gap-[var(--space-2)] p-[var(--space-3)] bg-[var(--success-soft,var(--surface-2))] text-[var(--fg-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] border">
              <MailCheck size={16} className="shrink-0 mt-0.5 text-[var(--accent)]" />
              <span>{t("success")}</span>
            </div>
            <Link
              href="/auth/login"
              className="block w-full h-9 leading-8 text-center border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-base)]"
            >
              {t("backToLogin")}
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-[var(--space-5)] flex items-start gap-[var(--space-2)] p-[var(--space-3)] bg-[var(--danger-soft)] text-[var(--danger-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] border">
                <AlertCircle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
                <span>{error}</span>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-2)]"
                >
                  {t("email")}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-[box-shadow,border-color] duration-[var(--motion-fast)] placeholder:text-[var(--meta)]"
                  placeholder="you@company.com"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-[var(--space-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
              >
                {busy && <Loader2 size={16} className="animate-spin" />}
                {busy ? t("submitting") : t("submit")}
              </button>
            </form>
          </>
        )}
      </div>

      <p className="mt-5 text-center text-[length:var(--text-sm)] text-[var(--muted)]">
        <Link
          href="/auth/login"
          className="text-[var(--accent)] font-[var(--weight-medium)] hover:underline underline-offset-2 px-1 py-0.5 -mx-1 -my-0.5 rounded"
        >
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
