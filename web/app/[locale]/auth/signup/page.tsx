"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, Link } from "@/lib/i18n-navigation";
import { Loader2, AlertCircle, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { track, getSessionId } from "@/lib/analytics";

interface InvitePreview {
  workspaceName: string;
  inviterName: string;
  emailMasked: string;
  expiresAt: string;
}

export default function SignupPage() {
  const t = useTranslations("auth.signup");
  const tError = useTranslations("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  // ─── 邀请链接支持（?invite=<token>）─────────────────────
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState("");

  useEffect(() => {
    // 用 window.location.search 而非 useSearchParams，避免静态预渲染时的 Suspense 约束
    const token = new URLSearchParams(window.location.search).get("invite");
    // P2 数据埋点：register_view（注册页首次渲染完成）
    // hasInvite 用于拆分自然注册与邀请注册两条子漏斗
    track("register_view", { path: "/auth/signup", hasInvite: !!token });
    if (!token) return;
    let cancelled = false;
    fetch(`/api/v1/invitations/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.status === 410 ? t("inviteExpired") : t("inviteInvalid"));
        }
        const json = await res.json();
        if (!cancelled) setInvitePreview(json.data as InvitePreview);
      })
      .catch((e: unknown) => {
        if (!cancelled) setInviteError(e instanceof Error ? e.message : t("inviteInvalid"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  /** 注册成功且带邀请 token 时：接受邀请加入对方工作区；失败返回 null 不阻断注册流程 */
  async function acceptInvitation(): Promise<string | null> {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return null;
    try {
      const res = await fetch(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        return (json.data as { workspaceId: string }).workspaceId ?? null;
      }
      setError(
        res.status === 402 ? t("inviteSeatsFull") : t("inviteJoinFailed"),
      );
    } catch {
      setError(t("inviteJoinFailed"));
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);

    // P2 数据埋点：register_submit（提交注册表单，含后续校验失败，语义为「尝试提交」）
    const inviteToken = new URLSearchParams(window.location.search).get("invite");
    track("register_submit", { hasInvite: !!inviteToken });

    try {
      // 上送 clientSessionId（获客段漏斗按 sessionId 串联）与 inviteToken（归因 channel="invite"）
      const clientSessionId = getSessionId();
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name: name || undefined,
          workspaceName,
          clientSessionId,
          ...(inviteToken ? { inviteToken } : {}),
        }),
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          res.status === 409 ? t("emailExists") : data.message || t("failed"),
        );
        setBusy(false);
        return;
      }

      // 带邀请 token：先接受邀请加入对方工作区；否则进入自己刚创建的工作区
      const invitedWid = await acceptInvitation();
      router.push(`/w/${invitedWid ?? data.data.workspace.id}`);
    } catch {
      setError(tError("networkError"));
      setBusy(false);
    }
  }

  const inputClass =
    "w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-[box-shadow,border-color] duration-[var(--motion-fast)] placeholder:text-[var(--meta)]";
  const labelClass =
    "block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] mb-[var(--space-2)]";

  // 密码强度：0 空 / 1 弱 / 2 中 / 3 强
  // 弱：纯字母或 <8 位；中：字母+数字 ≥8 位；强：字母+数字+特殊字符 ≥8 位
  function getPasswordStrength(pw: string): 0 | 1 | 2 | 3 {
    if (!pw) return 0;
    const hasLetter = /[a-zA-Z]/.test(pw);
    const hasDigit = /[0-9]/.test(pw);
    const hasSpecial = /[^a-zA-Z0-9]/.test(pw);
    if (pw.length < 8) return 1;
    if (hasLetter && !hasDigit && !hasSpecial) return 1;
    if (hasLetter && hasDigit && hasSpecial) return 3;
    if (hasLetter && hasDigit) return 2;
    return 1;
  }

  const strength = getPasswordStrength(password);
  const strengthLabel =
    strength === 1 ? t("passwordStrength.weak") : strength === 2 ? t("passwordStrength.medium") : strength === 3 ? t("passwordStrength.strong") : "";
  const strengthColor =
    strength === 1
      ? "bg-[var(--danger)]"
      : strength === 2
        ? "bg-[var(--warning)]"
        : "bg-[var(--success)]";

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

      {/* 邀请上下文提示（仅带 ?invite= 链接时出现） */}
      {(invitePreview || inviteError) && (
        <div
          className={`mb-[var(--space-4)] flex items-start gap-[var(--space-2)] p-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] ${
            invitePreview
              ? "bg-[var(--success-soft)] text-[var(--success-fg)]"
              : "bg-[var(--warn-soft)] text-[var(--warn-fg)]"
          }`}
        >
          <UserPlus size={16} className="shrink-0 mt-0.5" />
          {invitePreview ? (
            <span>
              {t.rich("invitePreview", {
                inviter: invitePreview.inviterName,
                workspace: invitePreview.workspaceName,
                email: invitePreview.emailMasked,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
          ) : (
            <span>{inviteError}</span>
          )}
        </div>
      )}

      <div className="bg-[var(--surface)] rounded-[var(--radius-lg)] p-4 sm:p-8 shadow-[var(--elev-sm)] border border-[var(--border)]">
        {error && (
          <div className="mb-[var(--space-5)] flex items-start gap-[var(--space-2)] p-[var(--space-3)] bg-[var(--danger-soft)] text-[var(--danger-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)]">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-[var(--space-4)]">
          <div>
            <label htmlFor="workspaceName" className={labelClass}>
              {t("workspaceName")}
            </label>
            <input
              id="workspaceName"
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className={inputClass}
              placeholder={t("workspaceNamePlaceholder")}
              required
              minLength={2}
            />
          </div>

          <div className="h-px -my-2 bg-[var(--border-soft)]" />

          <div>
            <label htmlFor="name" className={labelClass}>
              {t("yourName")}
              <span className="ml-1.5 font-[var(--weight-regular)] text-[var(--meta)]">
                {t("yourNameOptional")}
              </span>
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder={t("yourNamePlaceholder")}
            />
          </div>

          <div>
            <label htmlFor="email" className={labelClass}>
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="you@company.com"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              {t("password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder={t("passwordPlaceholder")}
              required
              minLength={8}
            />
            {strength > 0 && (
              <div
                className="mt-2 flex items-center gap-1.5"
                aria-label={t("passwordStrength.label", { level: strengthLabel })}
              >
                <div className="flex gap-1" aria-hidden="true">
                  <div
                    className={`h-1 w-6 rounded-full transition-colors duration-[var(--motion-fast)] ${strength >= 1 ? strengthColor : "bg-[var(--border)]"}`}
                  />
                  <div
                    className={`h-1 w-6 rounded-full transition-colors duration-[var(--motion-fast)] ${strength >= 2 ? strengthColor : "bg-[var(--border)]"}`}
                  />
                  <div
                    className={`h-1 w-6 rounded-full transition-colors duration-[var(--motion-fast)] ${strength >= 3 ? strengthColor : "bg-[var(--border)]"}`}
                  />
                </div>
                <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                  {strengthLabel}
                </span>
              </div>
            )}
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
      </div>

      <p className="mt-5 text-center text-[length:var(--text-sm)] text-[var(--muted)]">
        {t("loginLink")}{" "}
        <Link
          href="/auth/login"
          className="text-[var(--accent)] font-[var(--weight-medium)] hover:underline underline-offset-2"
        >
          {t("loginCta")}
        </Link>
      </p>
    </div>
  );
}
