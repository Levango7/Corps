// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Home } from "lucide-react";

/**
 * SidebarNavClient 契约（components/SidebarNavClient.tsx）：
 *  - 分组标题：collapsible → button(aria-expanded)；否则 div；desktop 折叠 → 分隔线
 *  - 高亮：exact → pathname === href；否则 pathname.startsWith(href) → aria-current=page
 *  - badge：>0 数字（>99 → 99+）；desktop 折叠 → 无文字圆点
 *  - 通知入口：unreadCount 同 badge 规则；notifActive 高亮
 *  - 底部按钮：desktop → onToggleCollapse（collapsed ? expand : collapse）；mobile → onClose
 *  - collapsible 分组：默认收起，含活跃路由时强制展开
 *  - 链接 onClick → onNavigate
 */

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

import { SidebarNavClient, type NavGroup, type NavItem } from "@/components/SidebarNavClient";

const LABELS = {
  notificationsLabel: "通知",
  expandLabel: "展开",
  collapseLabel: "收起",
  closeLabel: "关闭",
} as const;

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

type ClientProps = Parameters<typeof SidebarNavClient>[0];

function renderClient(overrides: Partial<ClientProps> = {}) {
  const props: ClientProps = {
    groups: BASE_GROUPS,
    pathname: "/w/ws-1/board",
    collapsed: false,
    notifHref: "/w/ws-1/notifications",
    notifActive: false,
    unreadCount: 0,
    mode: "desktop",
    ...LABELS,
    ...overrides,
  };
  return render(<SidebarNavClient {...props} />);
}

const linkByHref = (href: string) =>
  screen.getAllByRole("link").find((a) => a.getAttribute("href") === href);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("SidebarNavClient", () => {
  it("desktop 展开态：非折叠分组标题渲染为文字，条目与通知链接齐全", () => {
    renderClient();
    expect(screen.getByText("工作区")).toBeInTheDocument();
    expect(screen.getByText("通知")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("精确匹配（exact=true）→ aria-current=page", () => {
    renderClient({ pathname: "/w/ws-1/my-tasks" });
    expect(linkByHref("/w/ws-1/my-tasks")).toHaveAttribute("aria-current", "page");
  });

  it("前缀匹配（exact=false）：pathname 以 href 开头即高亮", () => {
    renderClient({ pathname: "/w/ws-1/board/col-2" });
    expect(linkByHref("/w/ws-1/board")).toHaveAttribute("aria-current", "page");
    expect(linkByHref("/w/ws-1/my-tasks")).not.toHaveAttribute("aria-current");
  });

  it("无匹配：所有链接均无 aria-current", () => {
    renderClient({ pathname: "/auth/login" });
    for (const a of screen.getAllByRole("link")) {
      expect(a).not.toHaveAttribute("aria-current");
    }
  });

  it("desktop 已折叠：链接 title=label 且文本隐藏", () => {
    renderClient({ collapsed: true });
    const board = linkByHref("/w/ws-1/board");
    expect(board).toHaveAttribute("title", "看板");
    expect(screen.queryByText("看板")).not.toBeInTheDocument();
    expect(screen.queryByText("通知")).not.toBeInTheDocument();
  });

  it("badge：0 隐藏、5 显示数字、120 显示 99+", () => {
    renderClient({ pathname: "/nowhere" });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("desktop 折叠时 badge 不渲染文字（改用圆点）", () => {
    renderClient({ collapsed: true, pathname: "/nowhere" });
    expect(screen.queryByText("5")).not.toBeInTheDocument();
    expect(screen.queryByText("99+")).not.toBeInTheDocument();
    expect(linkByHref("/w/ws-1/my-tasks")).toBeInTheDocument();
  });

  it("通知入口 unreadCount：>0 显示 99+；=0 无 badge", () => {
    const { rerender } = renderClient({ unreadCount: 150 });
    // 注意：分组内 badge=120 的条目也渲染 99+，断言须锚定通知链接自身
    expect(linkByHref("/w/ws-1/notifications")!.textContent).toContain("99+");
    rerender(
      <SidebarNavClient
        groups={BASE_GROUPS}
        pathname="/nowhere"
        collapsed={false}
        notifHref="/w/ws-1/notifications"
        notifActive={false}
        unreadCount={0}
        mode="desktop"
        {...LABELS}
      />,
    );
    expect(linkByHref("/w/ws-1/notifications")!.textContent).toBe("通知");
  });

  it("notifActive → 通知链接 aria-current=page；否则无", () => {
    const { rerender } = renderClient({ notifActive: true, pathname: "/w/ws-1/notifications" });
    expect(linkByHref("/w/ws-1/notifications")).toHaveAttribute("aria-current", "page");
    rerender(
      <SidebarNavClient
        groups={BASE_GROUPS}
        pathname="/w/ws-1/notifications"
        collapsed={false}
        notifHref="/w/ws-1/notifications"
        notifActive={false}
        unreadCount={0}
        mode="desktop"
        {...LABELS}
      />,
    );
    expect(linkByHref("/w/ws-1/notifications")).not.toHaveAttribute("aria-current");
  });

  it("desktop 底部按钮：未折叠=收起 → 点击 onToggleCollapse；已折叠=展开", () => {
    const onToggleCollapse = vi.fn();
    const { rerender } = renderClient({ onToggleCollapse });
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    rerender(
      <SidebarNavClient
        groups={BASE_GROUPS}
        pathname="/w/ws-1/board"
        collapsed
        notifHref="/w/ws-1/notifications"
        notifActive={false}
        unreadCount={0}
        mode="desktop"
        onToggleCollapse={onToggleCollapse}
        {...LABELS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "展开" }));
    expect(onToggleCollapse).toHaveBeenCalledTimes(2);
  });

  it("mobile 底部按钮：aria-label=关闭 → 点击 onClose（不触发折叠）", () => {
    const onClose = vi.fn();
    const onToggleCollapse = vi.fn();
    renderClient({ mode: "mobile", onClose, onToggleCollapse });
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it("collapsible 分组：默认收起，点标题展开（aria-expanded 切换）", () => {
    renderClient({
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

  it("collapsible 分组含当前路由 → 强制展开", () => {
    renderClient({
      pathname: "/w/ws-1/wiki/p1",
      groups: [{ label: "更多", collapsible: true, items: [item("/w/ws-1/wiki", "Wiki", false)] }],
    });
    expect(screen.getByText("Wiki")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更多" })).toHaveAttribute("aria-expanded", "true");
  });

  it("链接 onClick → onNavigate", () => {
    const onNavigate = vi.fn();
    renderClient({ onNavigate });
    fireEvent.click(linkByHref("/w/ws-1/im")!);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
