// 设置页共享类型、常量与辅助函数。
// 拆分自 app/[locale]/w/[wid]/settings/page.tsx，保持定义单一来源。

export type Role = "owner" | "admin" | "member";
export type ThemePref = "light" | "dark" | "system";
export type DefaultView = "board" | "list";
export type DensityPref = "compact" | "comfortable";
/** 强调色偏好（F6 增强）：蓝/绿/紫/橙 4 色 */
export type AccentColor = "blue" | "green" | "purple" | "orange";
/** 动画效果偏好（F6 增强）：减少/标准/增强 3 档 */
export type MotionPref = "reduced" | "standard" | "enhanced";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: string;
  seatLimit: number;
  memberCount: number;
  taskCount: number;
  createdAt: string;
  role: Role;
}

export interface NotifPref {
  emailEnabled: boolean;
  mentionEnabled: boolean;
}

/** 通知偏好持久化 key */
export const NOTIF_PREF_KEY = "corps_notif_pref";
/** 默认视图持久化 key */
export const DEFAULT_VIEW_KEY = "corps_default_view";
/** 密度偏好持久化 key */
export const DENSITY_KEY = "corps_density";
/** 强调色偏好持久化 key（F6 增强） */
export const ACCENT_COLOR_KEY = "corps_accent_color";
/** 动画效果偏好持久化 key（F6 增强） */
export const MOTION_KEY = "corps_motion";
/** 主题切换过渡时长（与 --motion-slow 对齐，避免硬编码） */
export const THEME_TRANSITION_MS = 220;

export function applyTheme(pref: ThemePref) {
  const resolved =
    pref === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : pref;
  document.documentElement.style.transition = `background-color ${THEME_TRANSITION_MS}ms`;
  document.documentElement.setAttribute("data-theme", resolved);
  localStorage.setItem("corps_theme", pref);
}

export function applyDensity(pref: DensityPref) {
  document.documentElement.setAttribute("data-density", pref);
  localStorage.setItem(DENSITY_KEY, pref);
}

export function applyAccentColor(pref: AccentColor) {
  document.documentElement.setAttribute("data-accent-color", pref);
  localStorage.setItem(ACCENT_COLOR_KEY, pref);
}

export function applyMotion(pref: MotionPref) {
  document.documentElement.setAttribute("data-motion", pref);
  localStorage.setItem(MOTION_KEY, pref);
}

export function loadNotifPref(): NotifPref {
  const defaults: NotifPref = { emailEnabled: true, mentionEnabled: true };
  try {
    const raw = localStorage.getItem(NOTIF_PREF_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return {
          emailEnabled: typeof (parsed as Record<string, unknown>).emailEnabled === "boolean"
            ? (parsed as Record<string, boolean>).emailEnabled
            : defaults.emailEnabled,
          mentionEnabled: typeof (parsed as Record<string, unknown>).mentionEnabled === "boolean"
            ? (parsed as Record<string, boolean>).mentionEnabled
            : defaults.mentionEnabled,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export function saveNotifPref(pref: NotifPref): void {
  localStorage.setItem(NOTIF_PREF_KEY, JSON.stringify(pref));
}