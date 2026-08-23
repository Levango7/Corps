"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";


export default function LoginPage() {
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
        setError(res.status === 401 ? "邮箱或密码不正确" : data.message || "登录失败");
        setBusy(false);
        return;
      }


      const first = data.data?.workspaces?.[0];
      if (first) {
        router.push(`/w/${first.id}`);
      } else {
        setError("账号未加入任何工作区，请联系管理员邀请");
        setBusy(false);
      }
    } catch {
      setError("网络异常，请检查连接后重试");
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-sm px-4 sm:px-0">
      <div className="mb-5 sm:mb-8">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          登录 corps
        </h1>
        <p className="mt-1.5 text-[length:var(--text-sm)] sm:text-[length:var(--text-base)] text-[var(--muted)]">
          继续你团队的工作。
        </p>
      </div>

      <div className="bg-[var(--surface)] rounded-[var(--radius-lg)] p-4 sm:p-8 shadow-[var(--elev-sm)] border border-[var(--border)]">
        {error && (
          <div
            className="mb-5 flex items-start gap-2 p-3 bg-[var(--danger-soft)] text-[var(--danger-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] border"
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
              className="block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] mb-1.5"
            >
              邮箱
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

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <label
                htmlFor="password"
                className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)]"
              >
                密码
              </label>
              <Link
                href="/auth/forgot"
                className="text-[var(--muted)] hover:text-[var(--accent)] text-xs"
              >
                忘记密码？
              </Link>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-[box-shadow,border-color] duration-[var(--motion-fast)] placeholder:text-[var(--meta)]"
              placeholder="••••••••"
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "正在登录" : "登录"}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-[length:var(--text-sm)] text-[var(--muted)]">
        还没有工作区？{" "}
        <Link
          href="/auth/signup"
          className="text-[var(--accent)] font-[var(--weight-medium)] hover:underline underline-offset-2 px-1 py-0.5 -mx-1 -my-0.5 rounded"
        >
          创建一个
        </Link>
      </p>
    </div>
  );
}
