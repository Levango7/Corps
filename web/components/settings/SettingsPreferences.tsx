"use client";

// 设置 - 偏好设置区：默认视图 + 通知偏好 + 外观主题 + 显示密度 + 强调色 + 动画效果。
// 拆分自 settings/page.tsx 第 606-814 行。全部为本地 localStorage 偏好，子组件自管状态。

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Bell, LayoutGrid, List, Rows3, Rows2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  applyTheme,
  applyDensity,
  applyAccentColor,
  applyMotion,
  loadNotifPref,
  saveNotifPref,
  DEFAULT_VIEW_KEY,
  DENSITY_KEY,
  ACCENT_COLOR_KEY,
  MOTION_KEY,
  type ThemePref,
  type DefaultView,
  type DensityPref,
  type AccentColor,
  type MotionPref,
  type NotifPref,
} from "./types";

const THEMES: { id: ThemePref; labelKey: string; icon: typeof Sun }[] = [
  { id: "light", labelKey: "themeLight", icon: Sun },
  { id: "dark", labelKey: "themeDark", icon: Moon },
  { id: "system", labelKey: "themeSystem", icon: Monitor },
];

const VIEWS: { id: DefaultView; icon: typeof LayoutGrid }[] = [
  { id: "board", icon: LayoutGrid },
  { id: "list", icon: List },
];

const DENSITIES: { id: DensityPref; labelKey: string; icon: typeof Rows3 }[] = [
  { id: "compact", labelKey: "densityCompact", icon: Rows3 },
  { id: "comfortable", labelKey: "densityComfortable", icon: Rows2 },
];

const ACCENT_COLORS: { id: AccentColor; swatch: string }[] = [
  { id: "blue", swatch: "var(--accent-blue)" },
  { id: "green", swatch: "var(--accent-green)" },
  { id: "purple", swatch: "var(--accent-purple)" },
  { id: "orange", swatch: "var(--accent-orange)" },
];

const MOTIONS: { id: MotionPref }[] = [
  { id: "reduced" },
  { id: "standard" },
  { id: "enhanced" },
];

const sectionClass =
  "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-4 sm:p-5";

/**
 * 安全枚举读取：从 localStorage 取值并校验是否属于合法枚举集合，
 * 非法或缺失时返回 fallback。避免 `as T` 不安全类型转换。
 */
function safeEnum<T extends string>(v: string | null, valid: readonly T[], fallback: T): T {
  return valid.includes(v as T) ? (v as T) : fallback;
}

export function SettingsPreferences() {
  const t = useTranslations("settings");
  const tTheme = useTranslations("theme");

  const [theme, setTheme] = useState<ThemePref>("system");
  const [defaultView, setDefaultView] = useState<DefaultView>("board");
  const [density, setDensity] = useState<DensityPref>("compact");
  const [accentColor, setAccentColor] = useState<AccentColor>("blue");
  const [motion, setMotion] = useState<MotionPref>("standard");
  const [notifPref, setNotifPref] = useState<NotifPref>({
    emailEnabled: true,
    mentionEnabled: true,
  });

  useEffect(() => {
    const stored = safeEnum(localStorage.getItem("corps_theme"), ["light", "dark", "system"] as const, "system");
    setTheme(stored);
    const storedView = safeEnum(localStorage.getItem(DEFAULT_VIEW_KEY), ["board", "list"] as const, "board");
    setDefaultView(storedView);
    const storedDensity = safeEnum(localStorage.getItem(DENSITY_KEY), ["compact", "comfortable"] as const, "compact");
    setDensity(storedDensity);
    const storedAccent = safeEnum(localStorage.getItem(ACCENT_COLOR_KEY), ["blue", "green", "purple", "orange"] as const, "blue");
    setAccentColor(storedAccent);
    const storedMotion = safeEnum(localStorage.getItem(MOTION_KEY), ["reduced", "standard", "enhanced"] as const, "standard");
    setMotion(storedMotion);
    setNotifPref(loadNotifPref());
  }, []);

  function pickTheme(tp: ThemePref) {
    setTheme(tp);
    applyTheme(tp);
  }

  function pickView(v: DefaultView) {
    setDefaultView(v);
    localStorage.setItem(DEFAULT_VIEW_KEY, v);
  }

  function pickDensity(d: DensityPref) {
    setDensity(d);
    applyDensity(d);
  }

  function pickAccentColor(c: AccentColor) {
    setAccentColor(c);
    applyAccentColor(c);
  }

  function pickMotion(m: MotionPref) {
    setMotion(m);
    applyMotion(m);
  }

  function updateNotifPref(patch: Partial<NotifPref>) {
    setNotifPref((prev) => {
      const next = { ...prev, ...patch };
      saveNotifPref(next);
      return next;
    });
  }

  // F6 增强：强调色 / 动画效果文本
  const accentNames: Record<AccentColor, string> = {
    blue: t("accentBlue"),
    green: t("accentGreen"),
    purple: t("accentPurple"),
    orange: t("accentOrange"),
  };
  const motionNames: Record<MotionPref, string> = {
    reduced: t("motionReduced"),
    standard: t("motionStandard"),
    enhanced: t("motionEnhanced"),
  };

  return (
    <>
      {/* 默认任务视图（P4：工作区设置增强） */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
          {t("defaultViewTitle")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          {t("defaultViewHint")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const active = defaultView === v.id;
            return (
              <button
                key={v.id}
                onClick={() => pickView(v.id)}
                className={`w-full sm:flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 ${active ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)]"}`}
              >
                <Icon size={16} />
                <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">
                  {v.id === "board" ? t("viewBoard") : t("viewList")}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 通知偏好（P4：工作区设置增强） */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
          <Bell size={16} className="text-[var(--muted)]" />
          {t("notifTitle")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">{t("notifHint")}</p>
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                {t("notifEmail")}
              </div>
              <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                {t("notifEmailHint")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={notifPref.emailEnabled}
              onChange={(e) => updateNotifPref({ emailEnabled: e.target.checked })}
              className="w-4 h-4 accent-[var(--accent)]"
            />
          </label>
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                {t("notifMention")}
              </div>
              <div className="text-[length:var(--text-xs)] text-[var(--meta)] mt-0.5">
                {t("notifMentionHint")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={notifPref.mentionEnabled}
              onChange={(e) => updateNotifPref({ mentionEnabled: e.target.checked })}
              className="w-4 h-4 accent-[var(--accent)]"
            />
          </label>
        </div>
      </section>

      {/* 外观 */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
          {t("appearanceTitle")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          {t("appearanceHint")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {THEMES.map((tp) => {
            const Icon = tp.icon;
            const active = theme === tp.id;
            return (
              <button
                key={tp.id}
                onClick={() => pickTheme(tp.id)}
                className="w-full sm:flex-1 flex flex-col items-center gap-2 py-2.5 rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                  color: active ? "var(--accent)" : "var(--fg-2)",
                }}
              >
                <Icon size={18} />
                <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">
                  {tTheme(tp.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 显示密度（F6：暖度调节密度切换） */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
          {t("density")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          {t("densityDesc")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {DENSITIES.map((d) => {
            const Icon = d.icon;
            const active = density === d.id;
            return (
              <button
                key={d.id}
                onClick={() => pickDensity(d.id)}
                className="w-full sm:flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                  color: active ? "var(--accent)" : "var(--fg-2)",
                }}
              >
                <Icon size={16} />
                <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">
                  {t(d.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 强调色（F6 增强：主题色自定义） */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
          {t("accentColor")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          {t("accentColorDesc")}
        </p>
        <div className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map((c) => {
            const active = accentColor === c.id;
            return (
              <button
                key={c.id}
                onClick={() => pickAccentColor(c.id)}
                aria-pressed={active}
                className="flex flex-col items-center gap-2 py-2.5 px-3 rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                }}
              >
                <span
                  className="w-6 h-6 rounded-full border-2"
                  style={{
                    backgroundColor: c.swatch,
                    borderColor: active ? "var(--fg)" : "transparent",
                  }}
                />
                <span
                  className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]"
                  style={{ color: active ? "var(--accent)" : "var(--fg-2)" }}
                >
                  {accentNames[c.id]}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 动画效果（F6 增强：减少/标准/增强三档） */}
      <section className={`${sectionClass} mt-5`}>
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
          {t("motion")}
        </h2>
        <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-4">
          {t("motionDesc")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {MOTIONS.map((m) => {
            const active = motion === m.id;
            return (
              <button
                key={m.id}
                onClick={() => pickMotion(m.id)}
                aria-pressed={active}
                className="w-full sm:flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                  color: active ? "var(--accent)" : "var(--fg-2)",
                }}
              >
                <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">
                  {motionNames[m.id]}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}