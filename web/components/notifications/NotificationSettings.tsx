"use client";

/**
 * 通知偏好设置面板
 *
 * 功能：
 *  - 邮件通知开关（emailNotify）
 *  - 应用内推送开关（pushNotify）
 *  - 免打扰时段设置（dndEnabled + dndStart + dndEnd）
 *  - 保存按钮 → PATCH /api/v1/notifications/preferences
 *
 * 数据来源：GET /api/v1/notifications/preferences
 * 样式：design token（var(--*)），lucide-react 图标 size 14/16
 * i18n：useTranslations("notifications")
 *
 * 经验来源：2026-09-16-ai-assist-dialog-editable-results-batch-create-pattern
 *  - 样式全用 var(--fg)、var(--muted)、var(--surface) 等 token，不写裸 hex
 *  - lucide-react 图标 size 14 或 16
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, Mail, Moon, Save, Loader2, AlertCircle, Check } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 通知偏好（对应 /api/v1/notifications/preferences 响应） */
interface NotificationPreference {
  id: string;
  emailNotify: boolean;
  pushNotify: boolean;
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  createdAt: string;
  updatedAt: string;
}

export function NotificationSettings() {
  const t = useTranslations("notifications");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // 编辑中的表单状态
  const [emailNotify, setEmailNotify] = useState(true);
  const [pushNotify, setPushNotify] = useState(true);
  const [dndEnabled, setDndEnabled] = useState(false);
  const [dndStart, setDndStart] = useState("22:00");
  const [dndEnd, setDndEnd] = useState("08:00");

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载偏好 */
  const loadPreference = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    try {
      const data = await api<NotificationPreference>(
        "/api/v1/notifications/preferences",
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setEmailNotify(data.emailNotify);
      setPushNotify(data.pushNotify);
      setDndEnabled(data.dndEnabled);
      setDndStart(data.dndStart);
      setDndEnd(data.dndEnd);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof Error && e.name === "AbortError") return;
      setError(t("error"));
      if (process.env.NODE_ENV === "development") {
        console.error("[NotificationSettings] load error:", e);
      }
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void loadPreference();
    return () => abortRef.current?.abort();
  }, [loadPreference]);

  /** 保存偏好 */
  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api<NotificationPreference>("/api/v1/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ emailNotify, pushNotify, dndEnabled, dndStart, dndEnd }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError(t("error"));
      } else {
        setError(t("error"));
      }
      if (process.env.NODE_ENV === "development") {
        console.error("[NotificationSettings] save error:", e);
      }
    } finally {
      setSaving(false);
    }
  }, [emailNotify, pushNotify, dndEnabled, dndStart, dndEnd, t]);

  // 加载态
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--surface)]">
        <div className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("loading")}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-5)] py-[var(--space-4)]"
      aria-label={t("settings")}
    >
      {/* 标题 */}
      <header className="flex items-center gap-[var(--space-2)]">
        <Bell size={16} className="text-[var(--accent)]" />
        <h2 className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("settings")}
        </h2>
      </header>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--danger)]">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* 邮件通知开关 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-[var(--space-1)]">
          <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            <Mail size={14} className="text-[var(--muted)]" />
            {t("emailNotify")}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={emailNotify}
          aria-label={t("emailNotify")}
          onClick={() => setEmailNotify(!emailNotify)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-[var(--radius-pill)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
            emailNotify
              ? "bg-[var(--accent)]"
              : "bg-[var(--surface-3)]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--accent-fg)] transition-transform duration-[var(--motion-fast)] ${
              emailNotify ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* 应用内推送开关 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-[var(--space-1)]">
          <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            <Bell size={14} className="text-[var(--muted)]" />
            {t("pushNotify")}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={pushNotify}
          aria-label={t("pushNotify")}
          onClick={() => setPushNotify(!pushNotify)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-[var(--radius-pill)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
            pushNotify
              ? "bg-[var(--accent)]"
              : "bg-[var(--surface-3)]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--accent-fg)] transition-transform duration-[var(--motion-fast)] ${
              pushNotify ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* 免打扰开关 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-[var(--space-1)]">
          <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
            <Moon size={14} className="text-[var(--muted)]" />
            {t("dnd")}
          </span>
          <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
            {t("dndHint")}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dndEnabled}
          aria-label={t("dnd")}
          onClick={() => setDndEnabled(!dndEnabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-[var(--radius-pill)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
            dndEnabled
              ? "bg-[var(--accent)]"
              : "bg-[var(--surface-3)]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--accent-fg)] transition-transform duration-[var(--motion-fast)] ${
              dndEnabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* 免打扰时段 */}
      {dndEnabled && (
        <div className="flex items-center gap-[var(--space-4)] pl-[var(--space-6)]">
          <div className="flex flex-col gap-[var(--space-1)]">
            <label
              htmlFor="dnd-start"
              className="text-[length:var(--text-xs)] text-[var(--muted)]"
            >
              {t("dndStart")}
            </label>
            <input
              id="dnd-start"
              type="time"
              value={dndStart}
              onChange={(e) => setDndStart(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              aria-label={t("dndStart")}
            />
          </div>
          <span className="text-[length:var(--text-sm)] text-[var(--muted)]">—</span>
          <div className="flex flex-col gap-[var(--space-1)]">
            <label
              htmlFor="dnd-end"
              className="text-[length:var(--text-xs)] text-[var(--muted)]"
            >
              {t("dndEnd")}
            </label>
            <input
              id="dnd-end"
              type="time"
              value={dndEnd}
              onChange={(e) => setDndEnd(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              aria-label={t("dndEnd")}
            />
          </div>
        </div>
      )}

      {/* 保存按钮 + 已保存标记 */}
      <div className="flex items-center gap-[var(--space-3)]">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          <span>{saving ? t("loading") : t("save")}</span>
        </button>
        {saved && (
          <span className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--success)]">
            <Check size={14} />
            <span>{t("saved")}</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default NotificationSettings;