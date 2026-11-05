// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Home } from "lucide-react";

/**
 * SidebarNav 契约（components/SidebarNav.tsx）：
 *  - 薄壳组件：useTranslations("nav") 取 4 个标签透传给 SidebarNavClient
 *    （notificationsLabel=nav:menu.notifications / expand / collapse / close）
 *  - 分组/条目/模式/回调全部由 props 决定；高亮与折叠行为在 SidebarNavClient
 */

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});

// 路由层：Link 退化为带 href/aria-*/title 的 <a>（可控）
vi.mock("@/lib/i18n-navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SidebarNav, type NavGroup, type NavItem } from "@/components/SidebarNav";

function item(href: string, label: string, exact: boolean, badge?: number): NavItem {
  return { href, label, icon: Home, exact, badge };
}

const BASE_GROUPS: NavGroup[] = [
  {
    label: "工作区",
    items: [item("/w/ws-1/board", "看板", false), item("/w/ws-1/my-tasks", "我的任务", true, 5)],
  },
  { label: null, items: [item("/w/ws-1/im", "消息", false, 120)] },
];

type NavProps = Parameters<typeof SidebarNav>[0];

function renderNav(overrides: Partial<NavProps> = {}) {
  const props: NavProps = {
    groups: BASE_GROUPS,
    pathname: "/w/ws-1/board",
    collapsed: false,
    notifHref: "/w/ws-1/notifications",
    notifActive: false,
    unreadCount: 0,
    mode: "desktop",
    ...overrides,
  };
  return render(<SidebarNav {...props} />);
}

const linkByHref = (href: string) =>
  screen.getAllByRole("link").find((a) => a.getAttribute("href") === href);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("SidebarNav（薄壳 + 高亮 + 折叠 + badge）", () => {
  it("desktop 展开态：渲染分组标题、条目链接与通知入口（翻译标签来自 nav 命名空间）", () => {
    renderNav();
    expect(screen.getByText("工作区")).toBeInTheDocument();
    expect(screen.getByText("nav:menu.notifications")).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/w/ws-1/board",
      "/w/ws-1/my-tasks",
      "/w/ws-1/im",
      "/w/ws-1/notifications",
    ]);
  });

  it("精确匹配（exact=true）→ aria-current=page；其余链接无 aria-current", () => {
    renderNav({ pathname: "/w/ws-1/my-tasks" });
    expect(linkByHref("/w/ws-1/my-tasks")).toHaveAttribute("aria-current", "page");
    expect(linkByHref("/w/ws-1/board")).not.toHaveAttribute("aria-current");
  });

  it("前缀匹配（exact=false）：pathname 以 href 开头即高亮", () => {
    renderNav({ pathname: "/w/ws-1/board/detail/3" });
    expect(linkByHref("/w/ws-1/board")).toHaveAttribute("aria-current", "page");
  });

  it("badge>0 渲染数字；>99 显示 99+", () => {
    renderNav();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("badge=0 不渲染 badge", () => {
    renderNav({
      groups: [{ label: null, items: [item("/w/ws-1/im", "消息", false, 0)] }],
      pathname: "/nowhere",
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("通知入口：unreadCount>0 显示 99+；notifActive → aria-current=page", () => {
    renderNav({ unreadCount: 150, notifActive: true, pathname: "/w/ws-1/notifications" });
    // 注意：分组内 badge=120 的条目也渲染 99+，断言须锚定通知链接自身
    expect(linkByHref("/w/ws-1/notifications")!.textContent).toContain("99+");
    expect(linkByHref("/w/ws-1/notifications")).toHaveAttribute("aria-current", "page");
  });

  it("desktop 未折叠：底部按钮 aria-label=collapse，点击触发 onToggleCollapse", () => {
    const onToggleCollapse = vi.fn();
    renderNav({ onToggleCollapse });
    const btn = screen.getByRole("button", { name: "nav:sidebar.collapse" });
    fireEvent.click(btn);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("desktop 已折叠：底部按钮 aria-label=expand，链接文本隐藏且 title=label", () => {
    const onToggleCollapse = vi.fn();
    renderNav({ collapsed: true, onToggleCollapse });
    const btn = screen.getByRole("button", { name: "nav:sidebar.expand" });
    fireEvent.click(btn);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    const board = linkByHref("/w/ws-1/board");
    expect(board).toHaveAttribute("title", "看板");
    expect(screen.queryByText("看板")).not.toBeInTheDocument();
    expect(screen.queryByText("工作区")).not.toBeInTheDocument();
  });

  it("mobile：底部按钮 aria-label=close，点击触发 onClose", () => {
    const onClose = vi.fn();
    renderNav({ mode: "mobile", onClose });
    fireEvent.click(screen.getByRole("button", { name: "nav:sidebar.close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "nav:sidebar.collapse" })).not.toBeInTheDocument();
  });

  it("mobile 点击链接触发 onNavigate", () => {
    const onNavigate = vi.fn();
    renderNav({ mode: "mobile", onNavigate });
    fireEvent.click(linkByHref("/w/ws-1/board")!);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("collapsible 分组默认收起：条目隐藏，点击标题展开且 aria-expanded 同步", () => {
    renderNav({
      pathname: "/nowhere",
      groups: [{ label: "更多", collapsible: true, items: [item("/w/ws-1/wiki", "Wiki", false)] }],
    });
    expect(screen.queryByText("Wiki")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "更多" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByText("Wiki")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更多" })).toHaveAttribute("aria-expanded", "true");
  });

  it("collapsible 分组含当前路由 → 强制展开（无需点击）", () => {
    renderNav({
      pathname: "/w/ws-1/wiki/page",
      groups: [{ label: "更多", collapsible: true, items: [item("/w/ws-1/wiki", "Wiki", false)] }],
    });
    expect(screen.getByText("Wiki")).toBeInTheDocument();
  });

  it("desktop 折叠时分组标题改为分隔线（不渲染文字）", () => {
    renderNav({ collapsed: true });
    expect(screen.queryByText("工作区")).not.toBeInTheDocument();
  });
});
