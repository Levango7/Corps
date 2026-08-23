"use client";

/**
 * 主题切换按钮 —— 共享组件。
 *
 * layout.tsx 顶栏 + settings 页外观面板共用。
 * 三态循环：system → light → dark → system。
 */

import { Moon, Sun, Monitor } from "lucide-react";

export type ThemePref = "system" | "light" | "dark";

const THEME_KEY = "corps_theme";
const THEME_ORDER: ThemePref[] = ["system", "light", "dark"];

/** 读取 localStorage 中的主题偏好（默认 system）。 */
export function readThemePref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** 解析主题偏好为实际主题（system → light/dark by matchMedia）。 */
export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

/** 应用主题到 document + 持久化。 */
export function applyTheme(pref: ThemePref): "light" | "dark" {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", resolved);
  localStorage.setItem(THEME_KEY, pref);
  return resolved;
}

interface ThemeToggleProps {
  pref: ThemePref;
  onChange: (next: ThemePref) => void;
}

export function ThemeToggle({ pref, onChange }: ThemeToggleProps) {
  const icon =
    pref === "system" ? <Monitor size={18} /> : pref === "light" ? <Sun size={18} /> : <Moon size={18} />;
  const label = pref === "system" ? "跟随系统" : pref === "light" ? "浅色" : "深色";

  function toggle() {
    const idx = THEME_ORDER.indexOf(pref);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    onChange(next);
  }

  return (
    <button
      onClick={toggle}
      className="p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
      aria-label={`切换主题（当前：${label}）`}
      title={label}
    >
      {icon}
    </button>
  );
}