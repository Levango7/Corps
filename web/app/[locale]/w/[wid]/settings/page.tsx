"use client";

import { use, useCallback, useEffect, useState } from "react";
import { Settings as SettingsIcon, AlertTriangle, Loader2, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { SettingsProfile } from "@/components/settings/SettingsProfile";
import { SettingsPreferences } from "@/components/settings/SettingsPreferences";
import { SettingsDataExport } from "@/components/settings/SettingsDataExport";
import { SettingsOverview } from "@/components/settings/SettingsOverview";
import { SettingsDangerZone } from "@/components/settings/SettingsDangerZone";
import type { Workspace } from "@/components/settings/types";

export default function SettingsPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("settings");
  const tErr = useTranslations("error");
  const [ws, setWs] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<Workspace>(`/api/v1/workspaces/${wid}`);
      setWs(data);
      setName(data.name);
      setSlug(data.slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("loadFailed"));
    }
  }, [wid, tErr]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function save() {
    if (!ws || busy) return;
    setError("");
    setSaved(false);
    setBusy(true);
    try {
      const payload: Record<string, string> = {};
      if (name.trim() !== ws.name) payload.name = name.trim();
      if (slug.trim() !== ws.slug) payload.slug = slug.trim();
      if (Object.keys(payload).length === 0) {
        setBusy(false);
        return;
      }
      await api(`/api/v1/workspaces/${wid}`, { method: "PATCH", body: JSON.stringify(payload) });
      setSaved(true);
      await load();
      setTimeout(() => setSaved(false), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : tErr("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const canEdit = ws ? ["owner", "admin"].includes(ws.role) : false;
  const dirty = ws ? name.trim() !== ws.name || slug.trim() !== ws.slug : false;

  // 初始加载：显示居中 spinner，避免空表单闪烁
  if (loading) {
    return (
      <div className="max-w-[var(--container-max)] mx-auto flex items-center justify-center py-[var(--space-16)]">
        <Loader2 size={24} className="animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  const inputClass =
    "w-full h-9 px-3 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)] placeholder:text-[var(--meta)]";
  const labelClass =
    "block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] mb-1.5";
  const sectionClass =
    "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

  return (
    <div className="max-w-[var(--container-max)] mx-auto">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <SettingsIcon size={20} className="text-[var(--muted)]" />
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

      {/* 个人资料 */}
      <SettingsProfile onError={setError} />

      {/* 工作区 */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-4">
          {t("workspaceTitle")}
        </h2>

        <div className="space-y-4">
          <div>
            <label htmlFor="ws-name" className={labelClass}>
              {t("workspaceName")}
            </label>
            <input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              className={inputClass}
              placeholder={t("workspaceNamePlaceholder")}
            />
          </div>

          <div>
            <label htmlFor="ws-slug" className={labelClass}>
              {t("workspaceSlug")}
            </label>
            <input
              id="ws-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              disabled={!canEdit}
              className={`${inputClass} font-[family-name:var(--font-mono)] text-[length:var(--text-sm)]`}
              placeholder={t("workspaceSlugPlaceholder")}
            />
            <p className="mt-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("workspaceSlugHint")}
            </p>
          </div>
        </div>

        {canEdit && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-5 pt-4 border-t border-[var(--border-soft)]">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="w-full sm:w-auto h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {t("save")}
            </button>
            {!dirty && !busy && (
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {t("noChanges")}
              </span>
            )}
            {saved && (
              <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--success-fg)]">
                <Check size={15} className="text-[var(--success)]" />
                {t("saved")}
              </span>
            )}
          </div>
        )}
        {!canEdit && ws && (
          <p className="mt-4 pt-4 border-t border-[var(--border-soft)] text-[length:var(--text-xs)] text-[var(--meta)]">
            {t("workspaceNoPermission")}
          </p>
        )}
      </section>

      {/* 偏好设置（默认视图 + 通知 + 外观 + 密度 + 强调色 + 动画） */}
      <SettingsPreferences />

      {/* 数据导出（P4：CSV 导出） */}
      {ws && (
        <SettingsDataExport wid={wid} wsSlug={ws.slug} onError={setError} />
      )}

      {/* 概况 */}
      {ws && <SettingsOverview ws={ws} />}

      {/* 危险操作（删除工作区 + 删除账户） */}
      <SettingsDangerZone ws={ws} wid={wid} onError={setError} />
    </div>
  );
}
