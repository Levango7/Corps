"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@/lib/i18n-navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * 密码重置页：邮件链接（/auth/reset-password?token=...）落地页。
 * 用 window.location.search 而非 useSearchParams，避免静态预渲染的 Suspense 约束
 * （与 signup 页的 invite 参数同一处理方式）。
 * 提交到 Better Auth 内置端点 /api/auth/reset-password（token 一次性消费）。
 */
export default function ResetPasswordPage() {
  const t = useTranslations("auth.resetPassword");
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
    setReady(true);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }
    if (!token) {
      setError(t("tokenMissing"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password, token }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // better-auth 的 token 无效/过期统一以 400 返回，code=INVALID_TOKEN
        const code = String(data?.code ?? "");
        if (code === "INVALID_TOKEN" || String(data?.message ?? "").includes("INVALID_TOKEN")) {
          setError(t("invalidToken"));
        } else {
          setError(data?.message || t("failed"));
        }
        return;
      }
      setDone(true);
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
        {!ready ? null : done ? (
          <div className="space-y-4">
            <p className="text-[length:var(--text-sm)] text-[var(--fg-2)]">{t("success")}</p>
            <Link
              href="/auth/login"
              className="block w-full h-9 leading-8 text-center bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-base)]"
            >
              {t("backToLogin")}
            </Link>
          </div>
        ) : !token ? (
          <div className="space-y-4">
            <div className="flex items-start gap-[var(--space-2)] p-[var(--space-3)] bg-[var(--danger-soft)] text-[var(--danger-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] border">
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
              <span>{t("tokenMissing")}</span>
            </div>
            <Link
              href="/auth/forgot-password"
              className="block w-full h-9 leading-8 text-center border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-base)]"
            >
              {t("failed")}
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
                  htmlFor="new-password"
                  className="block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-2)]"
                >
                  {t("newPassword")}
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-[box-shadow,border-color] duration-[var(--motion-fast)] placeholder:text-[var(--meta)]"
                  placeholder="•••••••"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="confirm-password"
                  className="block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-2)]"
                >
                  {t("confirmNewPassword")}
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-[box-shadow,border-color] duration-[var(--motion-fast)] placeholder:text-[var(--meta)]"
                  placeholder="•••••••"
                  minLength={8}
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
    </div>
  );
}
