"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";


export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);

    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined, workspaceName }),
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          res.status === 409
            ? "该邮箱已注册，直接登录即可"
            : data.message || "创建失败，请稍后重试"
        );
        setBusy(false);
        return;
      }


      router.push(`/w/${data.data.workspace.id}`);
    } catch {
      setError("网络异常，请检查连接后重试");
      setBusy(false);
    }
  }

  const inputClass =
    "w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:border-[var(--accent)] transition-[box-shadow,border-color] duration-[var(--motion-fast)] placeholder:text-[var(--meta)]";
  const labelClass =
    "block text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] mb-1.5";

  return (
    <div className="w-full max-w-sm px-4 sm:px-0">
      <div className="mb-5 sm:mb-8">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          创建工作区
        </h1>
        <p className="mt-1.5 text-[length:var(--text-sm)] sm:text-[length:var(--text-base)] text-[var(--muted)]">
          一分钟建好，之后再邀请同事。
        </p>
      </div>

      <div className="bg-[var(--surface)] rounded-[var(--radius-lg)] p-4 sm:p-8 shadow-[var(--elev-sm)] border border-[var(--border)]">
        {error && (
          <div className="mb-5 flex items-start gap-2 p-3 bg-[var(--danger-soft)] text-[var(--danger-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)]">
            <AlertCircle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="workspaceName" className={labelClass}>
              工作区名称
            </label>
            <input
              id="workspaceName"
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              className={inputClass}
              placeholder="例如：增长组"
              required
              minLength={2}
            />
          </div>

          <div className="h-px bg-[var(--border-soft)]" />

          <div>
            <label htmlFor="name" className={labelClass}>
              你的名字
              <span className="ml-1.5 font-[var(--weight-regular)] text-[var(--meta)]">选填</span>
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="同事看到的显示名"
            />
          </div>

          <div>
            <label htmlFor="email" className={labelClass}>
              邮箱
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
              密码
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder="至少 8 位"
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "正在创建" : "创建工作区"}
          </button>
        </form>
      </div>

      <p className="mt-5 text-center text-[length:var(--text-sm)] text-[var(--muted)]">
        已有账号？{" "}
        <Link
          href="/auth/login"
          className="text-[var(--accent)] font-[var(--weight-medium)] hover:underline underline-offset-2"
        >
          登录
        </Link>
      </p>
    </div>
  );
}
