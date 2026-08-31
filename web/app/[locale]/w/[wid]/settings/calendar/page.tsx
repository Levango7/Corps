"use client";

import { use, useCallback, useEffect, useState } from "react";
import {
  Calendar as CalendarIcon,
  Check,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Link2,
  Unlink,
  Mail,
  Clock,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { relTime as sharedRelTime } from "@/lib/format";

/** 连接状态 */
interface ConnectionStatus {
  provider: string;
  email: string;
  connected: boolean;
  lastSyncAt: string | null;
  syncStatus: string;
  syncError: string | null;
}

/** 同步设置（本地存储） */
interface SyncSettings {
  syncDueDateOnly: boolean;
  remindOneDay: boolean;
  remindOneHour: boolean;
}

const SYNC_SETTINGS_KEY = "corps_calendar_sync_settings";

function loadSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as SyncSettings;
  } catch {
    /* ignore */
  }
  return { syncDueDateOnly: true, remindOneDay: true, remindOneHour: false };
}

function saveSyncSettings(s: SyncSettings): void {
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(s));
}

export default function CalendarSettingsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("calendar");
  const tTime = useTranslations("time");
  const relTime = (iso: string | null) => (iso ? sharedRelTime(iso, tTime) : "—");
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [syncSettings, setSyncSettings] = useState<SyncSettings>({
    syncDueDateOnly: true,
    remindOneDay: true,
    remindOneHour: false,
  });
  // 回调参数（连接成功/失败）
  const [callbackMsg, setCallbackMsg] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ connections: ConnectionStatus[] }>(
        `/api/v1/workspaces/${wid}/calendar/status`,
      );
      setConnections(data.connections);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [wid]);

  useEffect(() => {
    load();
    setSyncSettings(loadSyncSettings());
    // 解析回调参数（?connected=google / ?error=xxx）
    const url = new URL(window.location.href);
    const connected = url.searchParams.get("connected");
    const errParam = url.searchParams.get("error");
    if (connected) {
      setCallbackMsg({ kind: "success", text: t("connected") });
      // 清理 URL 参数
      url.searchParams.delete("connected");
      window.history.replaceState({}, "", url.toString());
    } else if (errParam) {
      setCallbackMsg({ kind: "error", text: errParam });
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.toString());
    }
  }, [load, t]);

  function updateSyncSettings(patch: Partial<SyncSettings>) {
    setSyncSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSyncSettings(next);
      return next;
    });
  }

  /** 发起 OAuth 连接 */
  function handleConnect(provider: string) {
    // 重定向到 OAuth 授权端点
    window.location.href = `/api/v1/auth/calendar/connect/${provider}?wid=${encodeURIComponent(wid)}`;
  }

  /** 断开连接 */
  async function handleDisconnect(provider: string) {
    if (!window.confirm(t("confirmDisconnect"))) return;
    setDisconnecting(provider);
    setError("");
    try {
      await api(`/api/v1/auth/calendar/disconnect/${provider}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("disconnectFailed"));
    } finally {
      setDisconnecting(null);
    }
  }

  /** 立即同步 */
  async function handleSyncNow() {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    setError("");
    try {
      const res = await api<{ syncedConnections: number; success: boolean; error?: string }>(
        `/api/v1/workspaces/${wid}/calendar/sync`,
        { method: "POST" },
      );
      if (res.success) {
        setSyncMsg({ kind: "success", text: t("syncSuccess") });
      } else {
        setSyncMsg({ kind: "error", text: `${t("syncFailed")}: ${res.error ?? ""}` });
      }
      await load();
      setTimeout(() => setSyncMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("syncFailed"));
    } finally {
      setSyncing(false);
    }
  }

  const sectionClass =
    "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

  const googleConn = connections.find((c) => c.provider === "google");
  const outlookConn = connections.find((c) => c.provider === "outlook");
  const hasAnyConnection = connections.some((c) => c.connected);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)]">
          <CalendarIcon size={20} className="text-[var(--muted)]" />
          {t("title")}
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{t("subtitle")}</p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
          <span>{error}</span>
        </div>
      )}

      {callbackMsg && (
        <div
          className={`mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] ${
            callbackMsg.kind === "success"
              ? "bg-[var(--success-soft)] text-[var(--success-fg)]"
              : "bg-[var(--danger-soft)] text-[var(--danger-fg)]"
          }`}
        >
          {callbackMsg.kind === "success" ? (
            <Check size={16} className="shrink-0 mt-0.5 text-[var(--success)]" />
          ) : (
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
          )}
          <span>{callbackMsg.text}</span>
        </div>
      )}

      {syncMsg && (
        <div
          className={`mb-4 flex items-start gap-2 px-4 py-3 rounded-[var(--radius-md)] text-[length:var(--text-sm)] ${
            syncMsg.kind === "success"
              ? "bg-[var(--success-soft)] text-[var(--success-fg)]"
              : "bg-[var(--danger-soft)] text-[var(--danger-fg)]"
          }`}
        >
          {syncMsg.kind === "success" ? (
            <Check size={16} className="shrink-0 mt-0.5 text-[var(--success)]" />
          ) : (
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-[var(--danger)]" />
          )}
          <span>{syncMsg.text}</span>
        </div>
      )}

      {loading ? (
        <div className={sectionClass}>
          <div className="h-20 w-full rounded-[var(--radius-md)] bg-[var(--surface-2)] animate-pulse" />
        </div>
      ) : (
        <>
          {/* Google Calendar 连接卡片 */}
          <section className={sectionClass}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
                Google Calendar
              </h2>
              {googleConn?.connected && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--success-soft)] text-[var(--success-fg)] text-[length:var(--text-xs)] font-[var(--weight-medium)]">
                  <Check size={12} className="text-[var(--success)]" />
                  {t("connected")}
                </span>
              )}
            </div>

            {googleConn?.connected ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  <Mail size={14} className="text-[var(--meta)]" />
                  <span>{googleConn.email}</span>
                </div>
                <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--meta)]">
                  <Clock size={14} />
                  <span>
                    {t("lastSync")}: {relTime(googleConn.lastSyncAt)}
                  </span>
                </div>
                {googleConn.syncError && (
                  <div className="flex items-start gap-2 text-[length:var(--text-xs)] text-[var(--danger-fg)]">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>{googleConn.syncError}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={handleSyncNow}
                    disabled={syncing}
                    className="h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
                  >
                    {syncing ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    {t("syncNow")}
                  </button>
                  <button
                    onClick={() => handleDisconnect("google")}
                    disabled={disconnecting === "google"}
                    className="h-9 px-4 border border-[var(--danger)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
                  >
                    {disconnecting === "google" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Unlink size={15} />
                    )}
                    {t("disconnect")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("googleHint")}</p>
                <button
                  onClick={() => handleConnect("google")}
                  className="h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
                >
                  <Link2 size={15} />
                  {t("connectGoogle")}
                </button>
              </div>
            )}
          </section>

          {/* Outlook Calendar 连接卡片 */}
          <section className={`${sectionClass} mt-5`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
                Outlook Calendar
              </h2>
              {outlookConn?.connected && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--success-soft)] text-[var(--success-fg)] text-[length:var(--text-xs)] font-[var(--weight-medium)]">
                  <Check size={12} className="text-[var(--success)]" />
                  {t("connected")}
                </span>
              )}
            </div>

            {outlookConn?.connected ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  <Mail size={14} className="text-[var(--meta)]" />
                  <span>{outlookConn.email}</span>
                </div>
                <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--meta)]">
                  <Clock size={14} />
                  <span>
                    {t("lastSync")}: {relTime(outlookConn.lastSyncAt)}
                  </span>
                </div>
                {outlookConn.syncError && (
                  <div className="flex items-start gap-2 text-[length:var(--text-xs)] text-[var(--danger-fg)]">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                    <span>{outlookConn.syncError}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={handleSyncNow}
                    disabled={syncing}
                    className="h-9 px-4 border border-[var(--border)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
                  >
                    {syncing ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    {t("syncNow")}
                  </button>
                  <button
                    onClick={() => handleDisconnect("outlook")}
                    disabled={disconnecting === "outlook"}
                    className="h-9 px-4 border border-[var(--danger)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
                  >
                    {disconnecting === "outlook" ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Unlink size={15} />
                    )}
                    {t("disconnect")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[length:var(--text-sm)] text-[var(--meta)]">
                  {t("outlookHint")}
                </p>
                <button
                  onClick={() => handleConnect("outlook")}
                  className="h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
                >
                  <Link2 size={15} />
                  {t("connectOutlook")}
                </button>
              </div>
            )}
          </section>

          {/* 同步设置 */}
          <section className={`${sectionClass} mt-5`}>
            <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] mb-1">
              {t("syncSettings")}
            </h2>
            <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
              {t("syncSettingsHint")}
            </p>
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)]">
                    {t("syncDueDateOnly")}
                  </div>
                  <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                    {t("syncDueDateOnlyHint")}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={syncSettings.syncDueDateOnly}
                  onChange={(e) => updateSyncSettings({ syncDueDateOnly: e.target.checked })}
                  className="w-4 h-4 accent-[var(--accent)]"
                />
              </label>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)]">
                    {t("remindOneDay")}
                  </div>
                  <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                    {t("remindOneDayHint")}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={syncSettings.remindOneDay}
                  onChange={(e) => updateSyncSettings({ remindOneDay: e.target.checked })}
                  className="w-4 h-4 accent-[var(--accent)]"
                />
              </label>
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)]">
                    {t("remindOneHour")}
                  </div>
                  <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                    {t("remindOneHourHint")}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={syncSettings.remindOneHour}
                  onChange={(e) => updateSyncSettings({ remindOneHour: e.target.checked })}
                  className="w-4 h-4 accent-[var(--accent)]"
                />
              </label>
            </div>

            {hasAnyConnection && (
              <div className="mt-4 pt-4 border-t border-[var(--border-soft)]">
                <button
                  onClick={handleSyncNow}
                  disabled={syncing}
                  className="h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center gap-1.5"
                >
                  {syncing ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {t("syncNow")}
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
