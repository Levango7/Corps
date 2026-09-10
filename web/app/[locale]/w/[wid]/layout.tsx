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
  CheckSquare,
  FileText,
  BarChart3,
  Plus,
  Star,
} from "lucide-react";
import { api } from "@/lib/api";
import { setWorkspaceContext, track } from "@/lib/analytics";
import { listFavorites, type FavoriteEntry } from "@/lib/favorites";
import CommandPalette from "@/components/CommandPalette";
import { SidebarNav, type NavGroup } from "@/components/SidebarNav";
import { readThemePref, resolveTheme } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { useToast } from "@/components/Toast";
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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherHighlight, setSwitcherHighlight] = useState(-1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  // 星标（我的收藏）：这是 localStorage 数据，无服务端，
  // 跨 workspace 记录但当前页面仅展示当前 wid 下的条目
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [user, setUser] = useState<{
    name: string | null;
    email: string;
    image: string | null;
  } | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const switcherRef = useRef<HTMLDivElement>(null);
  const switcherListRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { wid } = use(params);
  const t = useTranslations("nav");
  const { toast } = useToast();

  // ─── 初始化：主题 + 侧栏折叠 + 工作区列表 + 埋点 ───
  useEffect(() => {
    // 主题持久化：UserMenu 接管下拉展示，这里只负责挂载时把存好的主题写到 DOM
    document.documentElement.setAttribute("data-theme", resolveTheme(readThemePref()));

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
      .then((u) => {
        setUser(u);
        setUserLoading(false);
      })
      .catch(() => setUserLoading(false));
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

  // 星标：挂载时读一次 + 同 tab localStorage 变化时刷新（自定义事件）
  useEffect(() => {
    function syncFavorites() {
      setFavorites(listFavorites());
    }
    syncFavorites();
    window.addEventListener("corps:favorites-changed", syncFavorites);
    return () => window.removeEventListener("corps:favorites-changed", syncFavorites);
  }, []);

  // ─── 回调 ───
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
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
      <div className="min-h-dvh flex items-center justify-center bg-[var(--shell-content)]">
        <div className="animate-pulse text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("workspace.loading")}
        </div>
      </div>
    );
  }

  // 顶部工作区下拉里的"创建工作区"：POST /api/v1/workspaces → 刷新并重定向到新工作区
  async function createWorkspace() {
    if (createBusy) return;
    const name = createName.trim();
    if (name.length < 2) {
      setCreateErr(t("workspace.createTooShort"));
      return;
    }
    setCreateBusy(true);
    setCreateErr("");
    try {
      const created = await api<{ id: string }>("/api/v1/workspaces", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setCreateOpen(false);
      setCreateName("");
      setSwitcherOpen(false);
      track("workspace_create", { from: wid });
      // 新 workspace 的 owner JWT 需重新签发，再跳过去
      try {
        await api("/api/v1/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ workspaceId: created.id }),
        });
      } catch {
        /* 失败忽略，稍后目标页 401 兜底 */
      }
      router.push(`/w/${created.id}`);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : t("workspace.createFailed"));
      setCreateBusy(false);
    }
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
    // "我的星标"：localStorage 收藏的任务。当前工作区下最多展示 5 条；
    // 没有则整个分组隐藏，避免噪音
    ...(favorites.filter((f) => f.workspaceId === wid).length > 0
      ? [
          {
            label: t("menu.favorites"),
            items: favorites
              .filter((f) => f.workspaceId === wid)
              .slice(0, 5)
              .map((f) => ({
                href: `/w/${f.workspaceId}/task/${f.taskId}`,
                label: f.title,
                icon: Star,
                exact: false,
              })),
          },
        ]
      : []),
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

  return (
    <div className="min-h-dvh flex flex-col">
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
            className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]"
          >
            <Logo size={22} />
          </Link>
          <span className="text-[var(--meta)] select-none">/</span>
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

              <div className="my-1 border-t border-[var(--border-soft)]" />

              {/* 管理工作区 — 直达 /settings 页 */}
              <Link
                href={`/w/${wid}/settings`}
                onClick={() => setSwitcherOpen(false)}
                className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <Settings size={14} className="text-[var(--muted)]" />
                <span className="flex-1 text-left truncate">{t("workspace.manage")}</span>
              </Link>

              {/* 创建工作区 — 展开为 inline 表单 */}
              {!createOpen ? (
                <button
                  onClick={() => {
                    setCreateOpen(true);
                    setCreateErr("");
                  }}
                  className="w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <Plus size={14} className="text-[var(--muted)]" />
                  <span className="flex-1 text-left truncate">{t("workspace.create")}</span>
                </button>
              ) : (
                <div className="px-[var(--space-3)] py-2">
                  <input
                    autoFocus
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createWorkspace();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setCreateOpen(false);
                        setCreateName("");
                        setCreateErr("");
                      }
                    }}
                    placeholder={t("workspace.createPlaceholder")}
                    disabled={createBusy}
                    className="w-full h-8 px-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--fg)] text-[length:var(--text-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
                  />
                  {createErr && (
                    <p className="mt-1 text-[length:var(--text-xs)] text-[var(--danger-fg)]">
                      {createErr}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateOpen(false);
                        setCreateName("");
                        setCreateErr("");
                      }}
                      disabled={createBusy}
                      className="h-7 px-2.5 text-[length:var(--text-xs)] text-[var(--fg-2)] rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)]"
                    >
                      {t("workspace.createCancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void createWorkspace()}
                      disabled={createBusy || createName.trim().length < 2}
                      className="h-7 px-3 text-[length:var(--text-xs)] bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-sm)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {createBusy ? t("workspace.creating") : t("workspace.createConfirm")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 搜索 */}
        <div className="flex-1 flex items-center justify-center px-2">
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden md:flex items-center gap-[var(--space-2)] px-[var(--space-3)] h-9 border border-[var(--accent-ring)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[var(--muted)] text-[length:var(--text-sm)] shadow-[var(--elev-sm)] hover:border-[var(--accent)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] transition-colors duration-[var(--motion-fast)] w-[var(--search-w-sm)] lg:w-[var(--search-w-lg)]"
          >
            <Search size={15} className="text-[var(--accent)]" />
            <span className="flex-1 text-left truncate text-[var(--fg-2)]">
              {t("search.placeholder")}
            </span>
            <kbd className="text-[length:var(--text-xs)] text-[var(--meta)] font-[family-name:var(--font-mono)] px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)]">
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

        {/* 右侧：通知 → 用户下拉（内含设置/语言/主题/退出） */}
        <div className="flex items-center gap-[var(--space-1)] ml-auto">
          {user ? (
            <UserMenu
              user={user}
              wid={wid}
              onLogout={async () => {
                try {
                  await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
                } catch {
                  /* 即使 logout 请求失败也跳转 */
                }
                toast("info", t("user.logoutDone"));
                router.push("/auth/login");
              }}
            />
          ) : userLoading ? (
            <div
              className="w-8 h-8 rounded-full bg-[var(--surface-2)] animate-pulse"
              aria-busy="true"
              aria-label={t("workspace.loading")}
            />
          ) : null}
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
