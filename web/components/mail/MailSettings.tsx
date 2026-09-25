"use client";

/**
 * 邮箱账户设置（MailSettings）
 *
 * 交互流程：
 *  1. 挂载时调用 GET /api/v1/mail/accounts 加载账户列表
 *  2. 添加账户表单：邮箱地址 + SMTP 配置 + 密码 + 显示名称
 *  3. 提交调用 POST /api/v1/mail/accounts
 *  4. 删除账户调用 DELETE /api/v1/mail/accounts/{id}
 *
 * Design token 样式 + lucide-react 图标 size 14/16。
 * Props: { workspaceId }
 *
 * 经验来源：2026-09-16-ai-assist-dialog-editable-results-batch-create-pattern
 *  - 样式全用 var(--fg)/var(--muted)/var(--surface)/var(--border) 等 token
 *  - lucide-react 图标 size 14 或 16：Plus（添加）、Trash2（删除）、Loader2（loading）
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Loader2, AlertCircle, Mail, X, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

/** 邮箱账户（列表项，不含 credential） */
interface MailAccount {
  id: string;
  email: string;
  displayName: string | null;
  provider: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  isDefault: boolean;
  createdAt: string;
}

/** MailSettings Props */
interface MailSettingsProps {
  /** 工作区 ID */
  workspaceId: string;
}

export default function MailSettings({ workspaceId }: MailSettingsProps) {
  const t = useTranslations("mail");
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // 表单状态
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [password, setPassword] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  /** 加载账户列表 */
  async function loadAccounts() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      const data = await api<MailAccount[]>(
        `/api/v1/mail/accounts?wid=${encodeURIComponent(workspaceId)}`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setAccounts(data);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development")
        console.error("[MailSettings] loadAccounts error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    loadAccounts();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  /** 添加账户 */
  async function handleAdd() {
    if (adding) return;
    if (!email.trim() || !smtpHost.trim() || !password.trim()) return;

    setAdding(true);
    try {
      const created = await api<MailAccount>("/api/v1/mail/accounts", {
        method: "POST",
        body: JSON.stringify({
          wid: workspaceId,
          email: email.trim(),
          displayName: displayName.trim() || undefined,
          smtpHost: smtpHost.trim(),
          smtpPort: Number(smtpPort),
          smtpSecure,
          credential: password,
        }),
      });
      setAccounts((prev) => [created, ...prev]);
      // 清空表单
      setEmail("");
      setDisplayName("");
      setSmtpHost("");
      setSmtpPort("587");
      setSmtpSecure(false);
      setPassword("");
      toast("success", t("updated"));
    } catch (e) {
      if (process.env.NODE_ENV === "development") console.error("[MailSettings] add error:", e);
      toast("error", t("error"));
    } finally {
      setAdding(false);
    }
  }

  /** 删除账户 */
  async function handleRemove(id: string) {
    if (removingId) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    setRemovingId(id);
    try {
      await api(`/api/v1/mail/accounts/${id}?wid=${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
      });
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      toast("success", t("accountDeleted"));
    } catch (e) {
      if (process.env.NODE_ENV === "development") console.error("[MailSettings] remove error:", e);
      toast("error", t("error"));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("settings")}
    >
      {/* ── 头部 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <Mail size={16} className="text-[var(--accent)]" />
          {t("settings")}
        </h2>
        <span className="text-[length:var(--text-xs)] text-[var(--muted)]">{accounts.length}</span>
      </header>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-4)]">
        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              aria-label={t("close")}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 添加账户表单 */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] p-4 space-y-3">
          <h3 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            <Plus size={14} className="text-[var(--accent)]" />
            {t("addAccount")}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 邮箱地址 */}
            <div>
              <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1">
                {t("email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
            </div>

            {/* 显示名称 */}
            <div>
              <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1">
                {t("displayName")}
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your Name"
                className="w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
            </div>

            {/* SMTP 主机 */}
            <div>
              <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1">
                {t("smtpHost")}
              </label>
              <input
                type="text"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.example.com"
                className="w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
            </div>

            {/* SMTP 端口 */}
            <div>
              <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1">
                {t("smtpPort")}
              </label>
              <input
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                min={1}
                max={65535}
                className="w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
            </div>

            {/* 密码 */}
            <div className="sm:col-span-2">
              <label className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1">
                {t("password")}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] placeholder:text-[var(--meta)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              />
            </div>
          </div>

          {/* SSL/TLS 开关 */}
          <label className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--fg)] cursor-pointer">
            <input
              type="checkbox"
              checked={smtpSecure}
              onChange={(e) => setSmtpSecure(e.target.checked)}
              className="rounded-[var(--radius-sm)] border-[var(--border)] text-[var(--accent)] focus-visible:ring-[var(--accent-ring)]"
            />
            SSL/TLS
          </label>

          {/* 添加按钮 */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleAdd}
              disabled={adding || !email.trim() || !smtpHost.trim() || !password.trim()}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--accent-fg)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {t("addAccount")}
            </button>
          </div>
        </div>

        {/* 账户列表 */}
        {loading ? (
          <div className="flex items-center justify-center py-6 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            {t("loading")}
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <Mail size={28} className="opacity-40" />
            <p>{t("noAccount")}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)]"
              >
                <Mail size={14} className="shrink-0 text-[var(--accent)]" />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                      {acc.email}
                    </span>
                    {acc.isDefault && <Check size={14} className="shrink-0 text-[var(--accent)]" />}
                  </div>
                  <p className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">
                    {acc.displayName ? `${acc.displayName} · ` : ""}
                    {acc.smtpHost}:{acc.smtpPort}
                    {acc.smtpSecure ? " (SSL)" : ""}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemove(acc.id)}
                  disabled={removingId === acc.id}
                  className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
                  aria-label={t("delete")}
                  title={t("delete")}
                >
                  {removingId === acc.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
