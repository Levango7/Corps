"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Kanban,
  Users,
  Settings,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Monitor,
  Search,
  Menu,
  X,
  ChevronsUpDown,
  Check,
  LogOut,
} from "lucide-react";
import { api, setToken } from "@/lib/api";
import CommandPalette from "@/components/CommandPalette";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

type ThemePref = "system" | "light" | "dark";

const THEME_KEY = "corps_theme";
const SIDEBAR_KEY = "corps_sidebar_collapsed";

export default function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wid: string }>;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [resolvedDark, setResolvedDark] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherHighlight, setSwitcherHighlight] = useState(-1);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [user, setUser] = useState<{ name: string | null; email: string; image: string | null } | null>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const switcherListRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { wid } = use(params);

  useEffect(() => {
    // 主题：与设置页共用 corps_theme（light | dark | system）
    const stored = localStorage.getItem(THEME_KEY);
    const pref: ThemePref = stored === "light" || stored === "dark" ? stored : "system";
    const resolved =
      pref === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : pref;
    setThemePref(pref);
    setResolvedDark(resolved === "dark");
    document.documentElement.setAttribute("data-theme", resolved);

    if (localStorage.getItem(SIDEBAR_KEY) === "true") setCollapsed(true);

    api<Workspace[]>("/api/v1/workspaces")
      .then((ws) => {
        setWorkspaces(ws);
        const cur = ws.find((w) => w.id === wid);
        if (cur) setWorkspace(cur);
        else router.push("/auth/login");
      })
      .catch(() => router.push("/auth/login"));
  }, [wid, router]);

  useEffect(() => {
    api<{ name: string | null; email: string; image: string | null }>("/api/v1/users/me")
      .then(setUser)
      .catch(() => {});
  }, []);

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

  // 移动端抽屉 focus trap：打开时聚焦首个可聚焦元素，Tab 到末尾回弹首元素
  useEffect(() => {
    if (!drawerOpen || !drawerRef.current) return;
    const node = drawerRef.current;
    const getFocusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
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

  // 工作区切换下拉：打开时高亮当前工作区并聚焦列表，支持 ↑↓ Enter 键盘导航
  useEffect(() => {
    if (!switcherOpen) return;
    setSwitcherHighlight(workspaces.findIndex((w) => w.id === wid));
    // 等待 DOM 渲染后聚焦列表容器，使 onKeyDown 能接收键盘事件
    const id = requestAnimationFrame(() => {
      switcherListRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [switcherOpen, workspaces, wid]);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
  }

  function toggleTheme() {
    // 三态循环：system → light → dark → system
    const order: ThemePref[] = ["system", "light", "dark"];
    const idx = order.indexOf(themePref);
    const next = order[(idx + 1) % order.length];
    const resolved =
      next === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : next;
    setThemePref(next);
    setResolvedDark(resolved === "dark");
    document.documentElement.setAttribute("data-theme", resolved);
    localStorage.setItem(THEME_KEY, next);
  }

  async function switchWorkspace(targetId: string) {
    setSwitcherOpen(false);
    if (targetId === wid) return;
    try {
      // 换工作区必须换 wid 令牌，否则 RLS 上下文仍指向旧工作区
      const res = await api<{ accessToken: string }>("/api/v1/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ workspaceId: targetId }),
      });
      if (res.accessToken) setToken(res.accessToken);
    } catch {
      /* 换区失败时保留当前令牌，由目标页的 401 兜底 */
    }
    router.push(`/w/${targetId}`);
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--shell-content)]">
        <div className="animate-pulse text-[length:var(--text-sm)] text-[var(--muted)]">
          正在载入工作区
        </div>
      </div>
    );
  }

  const navItems = [
    { href: `/w/${wid}`, label: "概览", icon: LayoutDashboard, exact: true },
    { href: `/w/${wid}/board`, label: "看板", icon: Kanban, exact: false },
    { href: `/w/${wid}/members`, label: "成员", icon: Users, exact: false },
    { href: `/w/${wid}/billing`, label: "计费", icon: CreditCard, exact: false },
    { href: `/w/${wid}/settings`, label: "设置", icon: Settings, exact: false },
  ];

  const themeIcon =
    themePref === "system" ? (
      <Monitor size={18} />
    ) : themePref === "light" ? (
      <Sun size={18} />
    ) : (
      <Moon size={18} />
    );
  const themeLabel =
    themePref === "system" ? "跟随系统" : themePref === "light" ? "浅色" : "深色";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-[var(--topbar-h)] px-[var(--space-4)] border-b border-[var(--shell-edge)] bg-[var(--shell-topbar)] flex items-center gap-[var(--space-3)] sticky top-0 z-[var(--z-sticky)]">
        {/* 汉堡菜单：< lg 显示，≥ lg 隐藏 */}
        <button
          onClick={() => setDrawerOpen(true)}
            className="lg:hidden p-[var(--space-2)] -ml-[var(--space-1)] rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          aria-label="打开侧栏"
        >
          <Menu size={18} />
        </button>

        <div className="flex items-center gap-[var(--space-2)] relative" ref={switcherRef}>
          <Link
            href={`/w/${wid}`}
            className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]"
          >
            corps
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
              aria-label="切换工作区"
              onKeyDown={(e) => {
                if (workspaces.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSwitcherHighlight((prev) => (prev + 1) % workspaces.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSwitcherHighlight((prev) => (prev - 1 + workspaces.length) % workspaces.length);
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
                切换工作区
              </div>
              {workspaces.map((w, i) => (
                <button
                  key={w.id}
                  onClick={() => switchWorkspace(w.id)}
                  aria-selected={switcherHighlight === i}
                  className={`w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg)] transition-colors duration-[var(--motion-fast)] ${
                    switcherHighlight === i ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className="flex-1 text-left truncate">{w.name}</span>
                  {w.id === wid && <Check size={14} className="text-[var(--accent)] shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 flex items-center justify-center">
          {/* ≥ md：完整搜索框 */}
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden md:flex items-center gap-[var(--space-2)] px-[var(--space-3)] h-8 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--muted)] text-[length:var(--text-sm)] hover:border-[var(--muted)] transition-colors duration-[var(--motion-fast)] w-[var(--search-w-sm)] lg:w-[var(--search-w-lg)]"
          >
            <Search size={15} />
            <span className="flex-1 text-left truncate">搜索任务</span>
            <kbd className="text-[length:var(--text-xs)] text-[var(--meta)] font-[family-name:var(--font-mono)]">
              ⌘K
            </kbd>
          </button>
          {/* < md：搜索图标按钮，触发命令面板 */}
          <button
            onClick={() => setCmdOpen(true)}
            className="md:hidden p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            aria-label="搜索"
          >
            <Search size={18} />
          </button>
        </div>

        <div className="flex items-center gap-[var(--space-1)] ml-auto">
          <button
            onClick={toggleTheme}
            className="p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
            aria-label={`切换主题（当前：${themeLabel}）`}
            title={themeLabel}
          >
            {themeIcon}
          </button>
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
              aria-label="个人设置"
              title="个人设置"
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
              if (!window.confirm("确定退出登录？")) return;
              try {
                await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
              } catch {
                // 即使 logout 请求失败也跳转
              }
              router.push("/auth/login");
            }}
            className="p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
            aria-label="退出登录"
            title="退出登录"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 桌面端侧栏 (≥ lg)：固定显示，可折叠（保留当前行为） */}
        <aside
          className={`hidden lg:flex bg-[var(--shell-sidebar)] border-r border-[var(--shell-edge)] flex-col transition-[width] duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
            collapsed ? "w-[var(--sidebar-w-collapsed)]" : "w-[var(--sidebar-w)]"
          }`}
        >
          <nav className="flex-1 overflow-y-auto py-[var(--space-3)] px-[var(--space-2)] space-y-[var(--space-1)]">
            {navItems.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-[var(--space-3)] px-[var(--space-3)] h-9 rounded-[var(--radius-md)] text-[length:var(--text-base)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                  } ${collapsed ? "justify-center px-0" : ""}`}
                  title={collapsed ? label : undefined}
                >
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              );
            })}
          </nav>

          <button
            onClick={toggleSidebar}
            className="m-[var(--space-2)] p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] flex items-center justify-center"
            aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </aside>

        <main className="flex-1 overflow-y-auto bg-[var(--shell-content)] p-[var(--space-4)] lg:p-[var(--space-6)]">{children}</main>
      </div>

      {/* 移动端抽屉 (< lg)：overlay + 滑入动画，独立于桌面端折叠状态 */}
      <div className="lg:hidden">
        {/* 背景蒙层：点击关闭 */}
        <div
          className={`fixed inset-0 bg-[var(--overlay)] z-[var(--z-modal)] transition-opacity duration-[var(--motion-base)] ${
            drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden={!drawerOpen}
        />
        {/* 抽屉：从左侧滑入 */}
        <aside
          ref={drawerRef}
          className={`fixed inset-y-0 left-0 w-[var(--sidebar-w-mobile)] h-full bg-[var(--shell-sidebar)] border-r border-[var(--shell-edge)] z-[var(--z-modal)] transform transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] flex flex-col ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          aria-hidden={!drawerOpen}
          role="dialog"
          aria-modal={drawerOpen ? "true" : undefined}
          aria-label="导航菜单"
        >
          <nav className="flex-1 overflow-y-auto py-[var(--space-3)] px-[var(--space-2)] space-y-[var(--space-1)]">
            {navItems.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setDrawerOpen(false)}
                  className={`flex items-center gap-[var(--space-3)] px-[var(--space-3)] h-9 rounded-[var(--radius-md)] text-[length:var(--text-base)] font-[var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                  }`}
                >
                  <Icon size={18} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              );
            })}
          </nav>
          <button
            onClick={() => setDrawerOpen(false)}
            className="m-[var(--space-2)] p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] flex items-center justify-center"
            aria-label="关闭侧栏"
          >
            <X size={16} />
          </button>
        </aside>
      </div>

      {cmdOpen && <CommandPalette wid={wid} onClose={() => setCmdOpen(false)} />}
    </div>
  );
}
