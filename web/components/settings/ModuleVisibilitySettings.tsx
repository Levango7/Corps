"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { MODULE_ICONS } from "@/lib/modules/icons";
import { OPTIONAL_MODULE_IDS, WORKSPACE_MODULES } from "@/lib/modules/registry";
import { Ripple } from "@/components/Ripple";

/**
 * 设置页 · 侧栏可选模块开关（P1-B2）
 *
 * 语义：开关只决定"这个模块是否出现在侧栏首屏"，**不删除任何东西**——
 * 关掉的模块仍在「更多」分组里，Cmd+K 也始终能直达。这正是产品方案
 * 「功能不做减法、做整合」的落地口径。
 *
 * 权限：只有 owner 可改（服务端 `settings:update`，与权限矩阵同一口径）。
 * 非 owner 看到的是只读态 + 一句说明，而不是"能点但存不上"。
 */
export function ModuleVisibilitySettings({
  wid,
  role,
  initialEnabled,
}: {
  wid: string;
  role: string;
  initialEnabled: readonly string[];
}) {
  const t = useTranslations("settings.moduleVisibility");
  const tNav = useTranslations("nav");

  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(initialEnabled));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const canEdit = role === "owner";

  const modules = useMemo(
    () =>
      OPTIONAL_MODULE_IDS.map((id) => WORKSPACE_MODULES.find((m) => m.id === id)).filter(
        (m): m is NonNullable<typeof m> => Boolean(m),
      ),
    [],
  );

  function toggle(id: string) {
    if (!canEdit) return;
    setSaved(false);
    setError("");
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!canEdit) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await api(`/api/v1/workspaces/${wid}/settings/modules`, {
        method: "PATCH",
        body: JSON.stringify({ enabledModules: [...enabled] }),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const sectionClass =
    "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

  return (
    <section className={`${sectionClass} mt-5`} aria-labelledby="module-visibility-title">
      <h2
        id="module-visibility-title"
        className="text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
      >
        {t("title")}
      </h2>
      <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">{t("description")}</p>

      <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {modules.map((m) => {
          const Icon = MODULE_ICONS[m.icon];
          const checked = enabled.has(m.id);
          return (
            <li key={m.id}>
              <label
                className={`flex items-center gap-3 min-h-[40px] rounded-[var(--radius-md)] px-2 -mx-2 transition-colors duration-[var(--motion-fast)] ${
                  canEdit ? "cursor-pointer hover:bg-[var(--surface-2)]" : "cursor-default"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(m.id)}
                  disabled={!canEdit}
                  // jsx-a11y 不把动态文案的 <label> 当关联标签，显式给可读名
                  aria-label={tNav(m.labelKey)}
                  className="size-4 shrink-0 accent-[var(--accent)] disabled:opacity-50"
                />
                <Icon size={16} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
                <span className="text-[length:var(--text-sm)] text-[var(--fg-2)] truncate">
                  {tNav(m.labelKey)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center gap-3">
        {canEdit ? (
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="relative overflow-hidden inline-flex items-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-base)]"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            <Ripple>{t("save")}</Ripple>
          </button>
        ) : (
          <p className="text-[length:var(--text-xs)] text-[var(--meta)]">{t("ownerOnly")}</p>
        )}
        {saved && (
          <span className="flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--success-fg)]">
            <Check size={15} className="text-[var(--success)]" />
            {t("saved")}
          </span>
        )}
        {error && (
          <span role="alert" className="text-[length:var(--text-sm)] text-[var(--danger)]">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
