"use client";

/**
 * UserMenu — 顶栏右侧单一入口：
 *   用户头像点击 → 下拉菜单（个人资料 + 主题 + 语言 + 设置 + 退出）
 *
 * 取代改版前的独立 LanguageSwitcher + ThemeToggle + 个人信息 Link，
 * 以及"主题文字 label"冗余。收口设计：
 *   - 头像 icon 固定可见，按钮点击展开 menu
 *   - menu 从上到下：用户信息 header → 快捷操作（设置）→ 语言 2 选 → 主题 3 选 → logout
 *   - 键盘可达：Esc 关、Tab 循环、focus 管理
 */

import { useEffect, useRef, useState } from "react";
import { Link, usePathname, useRouter } from "@/lib/i18n-navigation";
import { useLocale, useTranslations } from "next-intl";
import { Sun, Moon, Monitor, ChevronDown, Languages, LogOut, Settings } from "lucide-react";
import { locales, type Locale, localeNames } from "@/lib/i18n";
import { type ThemePref, readThemePref, applyTheme } from "@/components/ThemeToggle";

interface User {
  name: string | null;
  email: string;
  image: string | null;
}

interface UserMenuProps {
  user: User;
  wid: string;
  onLogout: () => Promise<void> | void;
}

const THEME_OPTIONS: { id: ThemePref; labelKey: string; icon: typeof Sun }[] = [
  { id: "system", labelKey: "theme.system", icon: Monitor },
  { id: "light", labelKey: "theme.light", icon: Sun },
  { id: "dark", labelKey: "theme.dark", icon: Moon },
];

export function UserMenu({ user, wid, onLogout }: UserMenuProps) {
  const t = useTranslations("nav");
  const tTheme = useTranslations("theme");
  const tLang = useTranslations("languageSwitcher");
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => readThemePref());
  const ref = useRef<HTMLDivElement>(null);

  // 仅在客户端渲染后同步预读（避免 hydration 差异）
  useEffect(() => {
    setTheme(readThemePref());
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClickOutside);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pickTheme(next: ThemePref) {
    setTheme(next);
    applyTheme(next);
  }

  function switchLocale(next: Locale) {
    if (next === currentLocale) return;
    router.replace(pathname, { locale: next });
  }

  const initial = (user.name || user.email)[0]?.toUpperCase() ?? "?";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("user.profile")}
        className="flex items-center gap-[var(--space-2)] px-1 h-9 rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="w-7 h-7 rounded-full border border-[var(--border)] object-cover"
          />
        ) : (
          <span className="w-7 h-7 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] flex items-center justify-center">
            {initial}
          </span>
        )}
        <ChevronDown
          size={12}
          className={`text-[var(--muted)] transition-transform duration-[var(--motion-fast)] ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-64 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--elev-lg)] py-1 z-[var(--z-dropdown)]"
        >
          {/* 用户信息 */}
          <div className="px-3 py-2 border-b border-[var(--border-soft)]">
            <div className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
              {user.name || user.email.split("@")[0]}
            </div>
            <div className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">
              {user.email}
            </div>
          </div>

          {/* 设置入口 */}
          <Link
            href={`/w/${wid}/settings`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <Settings size={14} className="text-[var(--muted)]" />
            {t("user.profile")}
          </Link>

          {/* 语言 */}
          <div className="px-3 py-2 border-t border-[var(--border-soft)] mt-1">
            <div className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5">
              <Languages size={12} />
              {tLang("label")}
            </div>
            <div className="flex items-center gap-1">
              {locales.map((loc) => (
                <button
                  key={loc}
                  onClick={() => switchLocale(loc)}
                  aria-current={loc === currentLocale ? "true" : undefined}
                  className={`flex-1 h-7 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                    loc === currentLocale
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  {localeNames[loc]}
                </button>
              ))}
            </div>
          </div>

          {/* 主题 */}
          <div className="px-3 py-2 border-t border-[var(--border-soft)]">
            <div className="text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5">
              {tTheme("sectionTitle")}
            </div>
            <div className="flex items-center gap-1">
              {THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = theme === opt.id;
                const label = t(opt.labelKey as "theme.system" | "theme.light" | "theme.dark");
                return (
                  <button
                    key={opt.id}
                    onClick={() => pickTheme(opt.id)}
                    aria-current={active ? "true" : undefined}
                    title={label}
                    className={`flex-1 h-7 rounded-[var(--radius-sm)] flex items-center justify-center transition-colors duration-[var(--motion-fast)] ${
                      active
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--fg-2)] hover:bg-[var(--surface-2)]"
                    }`}
                  >
                    <Icon size={14} />
                    <span className="sr-only">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 退出 */}
          <button
            onClick={async () => {
              setOpen(false);
              await onLogout();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-[length:var(--text-sm)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] transition-colors duration-[var(--motion-fast)] mt-1 border-t border-[var(--border-soft)]"
          >
            <LogOut size={14} />
            {t("user.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
