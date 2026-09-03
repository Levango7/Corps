"use client";

import { use, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { useRouter, usePathname, Link } from "@/lib/i18n-navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Kanban,
  Users,
  Settings,
  CreditCard,
  Search,
  Menu,
  ChevronsUpDown,
  Check,
  LogOut,
  CheckSquare,
  FileText,
  BarChart3,
} from "lucide-react";
import { api } from "@/lib/api";
import { setWorkspaceContext, track } from "@/lib/analytics";
import CommandPalette from "@/components/CommandPalette";
import { SidebarNav, type NavGroup } from "@/components/SidebarNav";
import {
  ThemeToggle,
  type ThemePref,
  readThemePref,
  resolveTheme,
  applyTheme,
} from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import type { WorkspaceSummary } from "@/lib/types";

const SIDEBAR_KEY = "corps_sidebar_collapsed";

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wid: string }>;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherHighlight, setSwitcherHighlight] = useState(-1);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [user, setUser] = useState<{
    name: string | null;
    email: string;
    image: string | null;
  } | null>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const switcherListRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { wid } = use(params);
  const t = useTranslations("nav");

  // ─── 初始化：主题 + 侧栏折叠 + 工作区列表 + 埋点 ───
  useEffect(() => {
    const pref = readThemePref();
    setThemePref(pref);
    document.documentElement.setAttribute("data-theme", resolveTheme(pref));

    if (localStorage.getItem(SIDEBAR_KEY) === "true") setCollapsed(true);

    setWorkspaceContext(wid);
    track("page_view", { path: pathname });

    api<WorkspaceSummary[]>("/api/v1/workspaces")
      .then((ws) => {
        setWorkspaces(ws);
        const cur = ws.find((w) => w.id === wid);
        if (cur) setWorkspace(cur);
        else router.push("/auth/login");
      })
      .catch(() => router.push("/auth/login"));
  }, [wid, router, pathname]);

  useEffect(() => {
    api<{ name: string | null; email: string; image: string | null }>("/api/v1/users/me")
      .then(setUser)
      .catch(() => {});
  }, []);

  // 通知未读数：每 30 秒轮询
  useEffect(() => {
    let active = true;
    function fetchCount() {
      api<{ unread: number }>(`/api/v1/workspaces/${wid}/notifications?count=true`)
        .then((res) => {
          if (active) setUnreadCount(res.unread ?? 0);
        })
        .catch(() => {});
    }
    fetchCount();
    const timer = setInterval(fetchCount, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [wid, pathname]);

  // ─── 全局键盘 + 外部点击 ───
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
        setSwitcherOpen(false);
        setDrawerOpen(false);
      }
    }
    function onClick(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  // 移动端抽屉 focus trap
  useEffect(() => {
    if (!drawerOpen || !drawerRef.current) return;
    const node = drawerRef.current;
    const getFocusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const focusables = getFocusable();
    if (focusables.length > 0) focusables[0].focus();

    function onTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    node.addEventListener("keydown", onTab);
    return () => node.removeEventListener("keydown", onTab);
  }, [drawerOpen]);

  // 工作区切换下拉：打开时高亮当前
  useEffect(() => {
    if (!switcherOpen) return;
    setSwitcherHighlight(workspaces.findIndex((w) => w.id === wid));
    const id = requestAnimationFrame(() => {
      switcherListRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [switcherOpen, workspaces, wid]);

  // ─── 回调 ───
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
  }

  function handleThemeChange(next: ThemePref) {
    setThemePref(next);
    applyTheme(next);
  }

  async function switchWorkspace(targetId: string) {
    setSwitcherOpen(false);
    if (targetId === wid) return;
    track("workspace_switch", { from: wid, to: targetId });
    try {
      await api("/api/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ workspaceId: targetId }),
      });
    } catch {
      /* 换区失败时保留当前令牌，由目标页的 401 兜底 */
    }
    router.push(`/w/${targetId}`);
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--shell-content)]">
        <div className="animate-pulse text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("workspace.loading")}
        </div>
      </div>
    );
  }

  // 导航分组
  const navGroups: NavGroup[] = [
    {
      label: null,
      items: [
        { href: `/w/${wid}`, label: t("menu.overview"), icon: LayoutDashboard, exact: true },
        { href: `/w/${wid}/board`, label: t("menu.board"), icon: Kanban, exact: false },
        { href: `/w/${wid}/my-tasks`, label: t("menu.myTasks"), icon: CheckSquare, exact: false },
        { href: `/w/${wid}/decisions`, label: t("menu.decisions"), icon: FileText, exact: false },
        { href: `/w/${wid}/documents`, label: t("menu.documents"), icon: FileText, exact: false },
      ],
    },
    {
      label: t("menu.admin"),
      items: [
        { href: `/w/${wid}/members`, label: t("menu.members"), icon: Users, exact: false },
        { href: `/w/${wid}/billing`, label: t("menu.billing"), icon: CreditCard, exact: false },
        { href: `/w/${wid}/analytics`, label: t("menu.analytics"), icon: BarChart3, exact: false },
        { href: `/w/${wid}/settings`, label: t("menu.settings"), icon: Settings, exact: false },
      ],
    },
  ];

  const notifHref = `/w/${wid}/notifications`;
  const notifActive = pathname.startsWith(notifHref);
  const themeLabel =
    themePref === "system"
      ? t("theme.system")
      : themePref === "light"
        ? t("theme.light")
        : t("theme.dark");

  return (
    <div className="min-h-screen flex flex-col">
      {/* ─── 顶栏 ─── */}
      <header className="h-[var(--topbar-h)] px-[var(--space-4)] border-b border-[var(--shell-edge)] bg-[var(--shell-topbar)] flex items-center gap-[var(--space-3)] sticky top-0 z-[var(--z-sticky)]">
        <button
          onClick={() => setDrawerOpen(true)}
          className="lg:hidden p-[var(--space-2)] -ml-[var(--space-1)] rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          aria-label={t("sidebar.open")}
        >
          <Menu size={18} />
        </button>

        {/* 工作区切换器 */}
        <div className="flex items-center gap-[var(--space-2)] relative" ref={switcherRef}>
          <Link
            href={`/w/${wid}`}
            className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]"
          >
            <Logo size={22} />
          </Link>
          <span className="text-[var(--border)] select-none">/</span>
          <button
            onClick={() => setSwitcherOpen((v) => !v)}
            className="flex items-center gap-[var(--space-1)] px-[var(--space-2)] h-8 rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] text-[length:var(--text-sm)]"
          >
            <span className="text-[var(--fg)] max-w-[100px] sm:max-w-[180px] truncate">
              {workspace.name}
            </span>
            <ChevronsUpDown size={13} className="text-[var(--meta)]" />
          </button>
          {switcherOpen && (
            <div
              ref={switcherListRef}
              role="listbox"
              tabIndex={-1}
              aria-label={t("workspace.switch")}
              onKeyDown={(e) => {
                if (workspaces.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSwitcherHighlight((prev) => (prev + 1) % workspaces.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSwitcherHighlight(
                    (prev) => (prev - 1 + workspaces.length) % workspaces.length,
                  );
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (switcherHighlight >= 0 && switcherHighlight < workspaces.length) {
                    switchWorkspace(workspaces[switcherHighlight].id);
                  }
                }
              }}
              className="absolute top-full left-0 mt-1.5 w-60 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--elev-lg)] py-[var(--space-1)] z-[var(--z-dropdown)] focus-visible:outline-none"
            >
              <div className="px-[var(--space-3)] py-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
                {t("workspace.switch")}
              </div>
              {workspaces.map((w, i) => (
                <button
                  key={w.id}
                  onClick={() => switchWorkspace(w.id)}
                  aria-selected={switcherHighlight === i}
                  className={`w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] ${
                    switcherHighlight === i
                      ? "bg-[var(--surface-2)]"
                      : "hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className="flex-1 text-left truncate">{w.name}</span>
                  {w.id === wid && <Check size={14} className="text-[var(--accent)] shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 搜索 */}
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden md:flex items-center gap-[var(--space-2)] px-[var(--space-3)] h-8 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--muted)] text-[length:var(--text-sm)] hover:border-[var(--muted)] transition-colors duration-[var(--motion-fast)] w-[var(--search-w-sm)] lg:w-[var(--search-w-lg)]"
          >
            <Search size={15} />
            <span className="flex-1 text-left truncate">{t("search.placeholder")}</span>
            <kbd className="text-[length:var(--text-xs)] text-[var(--meta)] font-[family-name:var(--font-mono)]">
              ⌘K
            </kbd>
          </button>
          <button
            onClick={() => setCmdOpen(true)}
            className="md:hidden p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            aria-label={t("search.ariaLabel")}
          >
            <Search size={18} />
          </button>
        </div>

        {/* 右侧：语言切换 + 主题 + 用户 + 退出 */}
        <div className="flex items-center gap-[var(--space-1)] ml-auto">
          <LanguageSwitcher />
          <ThemeToggle pref={themePref} onChange={handleThemeChange} />
          <span
            className="hidden md:inline text-[length:var(--text-xs)] text-[var(--meta)] select-none"
            aria-hidden="true"
          >
            {themeLabel}
          </span>
          {user && (
            <Link
              href={`/w/${wid}/settings`}
              className="flex items-center gap-[var(--space-2)] px-[var(--space-2)] rounded-lg hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
              aria-label={t("user.profile")}
              title={t("user.profile")}
            >
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt={user.name ?? user.email}
                  className="w-7 h-7 rounded-full object-cover"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[var(--surface-3)] flex items-center justify-center text-[length:var(--text-xs)] font-[var(--weight-medium)] text-[var(--fg-2)]">
                  {(user.name ?? user.email)[0].toUpperCase()}
                </div>
              )}
              <span className="hidden sm:inline text-[length:var(--text-sm)] text-[var(--fg-2)] max-w-[100px] truncate">
                {user.name ?? user.email.split("@")[0]}
              </span>
            </Link>
          )}
          <button
            onClick={async () => {
              if (!window.confirm(t("user.logoutConfirm"))) return;
              try {
                await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
              } catch {
                // 即使 logout 请求失败也跳转
              }
              router.push("/auth/login");
            }}
            className="p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
            aria-label={t("user.logout")}
            title={t("user.logout")}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 桌面端侧栏 (≥ lg) */}
        <aside
          className={`hidden lg:flex bg-[var(--shell-sidebar)] border-r border-[var(--shell-edge)] flex-col transition-[width] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
            collapsed ? "w-[var(--sidebar-w-collapsed)]" : "w-[var(--sidebar-w)]"
          }`}
        >
          <SidebarNav
            groups={navGroups}
            pathname={pathname}
            collapsed={collapsed}
            notifHref={notifHref}
            notifActive={notifActive}
            unreadCount={unreadCount}
            onToggleCollapse={toggleSidebar}
            mode="desktop"
          />
        </aside>

        <main className="flex-1 overflow-y-auto bg-[var(--shell-content)] p-[var(--space-4)] lg:p-[var(--space-6)]">
          {children}
        </main>
      </div>

      {/* 移动端抽屉 (< lg) */}
      <div className="lg:hidden">
        <div
          className={`fixed inset-0 bg-[var(--overlay)] z-[var(--z-modal)] transition-opacity duration-[var(--motion-base)] ${
            drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden={!drawerOpen}
        />
        <aside
          ref={drawerRef}
          className={`fixed inset-y-0 left-0 w-[var(--sidebar-w-mobile)] h-full bg-[var(--shell-sidebar)] border-r border-[var(--shell-edge)] z-[var(--z-modal)] transform transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] flex flex-col ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          aria-hidden={!drawerOpen}
          role="dialog"
          aria-modal={drawerOpen ? "true" : undefined}
          aria-label={t("sidebar.navLabel")}
        >
          <SidebarNav
            groups={navGroups}
            pathname={pathname}
            collapsed={false}
            notifHref={notifHref}
            notifActive={notifActive}
            unreadCount={unreadCount}
            onNavigate={() => setDrawerOpen(false)}
            onClose={() => setDrawerOpen(false)}
            mode="mobile"
          />
        </aside>
      </div>

      {cmdOpen && <CommandPalette wid={wid} onClose={() => setCmdOpen(false)} />}
    </div>
  );
}
