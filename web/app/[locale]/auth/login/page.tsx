"use client";

import { useState, type FormEvent } from "react";
import { useRouter, Link } from "@/lib/i18n-navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { track } from "@/lib/analytics";

export default function LoginPage() {
  const t = useTranslations("auth.login");
  const tError = useTranslations("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        setError(res.status === 401 ? t("invalidCredentials") : data.message || t("failed"));
        setBusy(false);
        return;
      }

      const first = data.data?.workspaces?.[0];
      if (first) {
        router.push(`/w/${first.id}`);
      } else {
        setError(t("noWorkspace"));
        setPassword("");
        setBusy(false);
      }
    } catch {
      setError(tError("networkError"));
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm px-4 sm:px-0">
      <div className="card-lift bg-[var(--surface)] rounded-[var(--radius-xl)] p-5 sm:p-8 shadow-[var(--elev-lg)] border border-[var(--border)] ring-1 ring-[color-mix(in_srgb,var(--accent)_7%,transparent)]">
        {/* 卡片内顶部居中标题 */}
        <h1 className="mb-6 text-center text-[length:var(--text-lg)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          {t("title")}
        </h1>
        {error && (
          <div
            className="mb-[var(--space-5)] flex items-start gap-[var(--space-2)] p-[var(--space-3)] bg-[var(--danger-soft)] text-[var(--danger-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] border"
            style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)" }}
          >
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
              placeholder={t("emailPlaceholder")}
              required
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-2)]"
            >
              {t("password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-[box-shadow,border-color] duration-[var(--motion-fast)] placeholder:text-[var(--meta)]"
              placeholder="•••••••"
              required
            />
          </div>

          <div className="flex justify-end">
            <Link
              href="/auth/forgot-password"
              className="text-[length:var(--text-xs)] text-[var(--muted)] hover:text-[var(--fg)] hover:underline underline-offset-2"
            >
              {t("forgotLink")}
            </Link>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="btn-press w-full h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-[var(--space-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? t("submitting") : t("submit")}
          </button>
        </form>
      </div>

        <div className="mt-6 text-center text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("signupLink")}{" "}
          <Link
            href="/auth/signup"
            className="font-[var(--weight-semibold)] text-[var(--accent)] hover:underline underline-offset-2"
            onClick={() => {
              track("click_signup", { cta: "card_footer", path: "/auth/login" });
            }}
          >
            {t("signupCta")}
          </Link>
      </div>
    </div>
  );
}
