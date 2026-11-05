// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * MobileBottomNav 契约（components/layout/MobileBottomNav.tsx）：
 *  1. 仅 /w/{wid}/... 路由渲染；其它路由返回 null
 *  2. 四个 Tab（myTasks/messages/documents/settings）指向 /w/{wid}/{segment}
 *  3. 当前 Tab（精确或前缀）aria-current="page" 且挂 active 指示条（唯一）
 *  4. aria-label 走 nav.menu 命名空间；nav 有 navLabel
 *  5. prefers-reduced-motion 时指示条 transition duration 0
 */

const nav = vi.hoisted(() => ({ pathname: "/w/ws-1/my-tasks" }));

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
// 路由层：usePathname 用可控变量，Link 退化为带 href/aria-* 的 <a>
vi.mock("@/lib/i18n-navigation", () => ({
  usePathname: () => nav.pathname,
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// framer-motion：layoutId 是 motion 私有属性，落 DOM 会告警，mock 成朴素 div
vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      layoutId: _layoutId,
      transition: _transition,
      ...rest
    }: {
      children?: React.ReactNode;
      [k: string]: unknown;
    }) => <div {...rest}>{children}</div>,
  },
  useReducedMotion: () => false,
}));

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

const SET_PATH = (p: string) => {
  nav.pathname = p;
};

beforeEach(() => {
  SET_PATH("/w/ws-1/my-tasks");
});
afterEach(() => cleanup());

describe("MobileBottomNav", () => {
  it("非工作区路由 → 不渲染", () => {
    SET_PATH("/auth/login");
    const { container } = render(<MobileBottomNav />);
    expect(container.firstChild).toBeNull();
  });

  it("工作区路由 → 渲染 nav，aria-label=nav.menu:navLabel", () => {
    render(<MobileBottomNav />);
    expect(screen.getByRole("navigation", { name: "nav.menu:navLabel" })).toBeInTheDocument();
  });

  it("四个 Tab 的 href 精确指向工作区子路由", () => {
    render(<MobileBottomNav />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/w/ws-1/my-tasks",
      "/w/ws-1/im",
      "/w/ws-1/documents",
      "/w/ws-1/settings",
    ]);
  });

  it("Tab 文本走 nav.menu 命名空间", () => {
    render(<MobileBottomNav />);
    expect(screen.getByText("nav.menu:myTasks")).toBeInTheDocument();
    expect(screen.getByText("nav.menu:messages")).toBeInTheDocument();
    expect(screen.getByText("nav.menu:documents")).toBeInTheDocument();
    expect(screen.getByText("nav.menu:settings")).toBeInTheDocument();
  });

  it("当前 Tab 精确匹配 → aria-current=page，其余无", () => {
    render(<MobileBottomNav />);
    const current = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("href")).toBe("/w/ws-1/my-tasks");
  });

  it("子路径前缀命中（/w/ws-1/im/thread-9）→ messages Tab 高亮", () => {
    SET_PATH("/w/ws-1/im/thread-9");
    render(<MobileBottomNav />);
    const active = screen.getByRole("link", { name: "nav.menu:messages" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "nav.menu:myTasks" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("只有 active Tab 挂指示条（div 数量与高亮一致）", () => {
    render(<MobileBottomNav />);
    const indicators = document.querySelectorAll("nav a > div.absolute.top-0");
    expect(indicators).toHaveLength(1);
  });

  it("不同 wid 路由 → href 用该 wid", () => {
    SET_PATH("/w/another-ws/documents");
    render(<MobileBottomNav />);
    const links = screen.getAllByRole("link");
    expect(links[0].getAttribute("href")).toBe("/w/another-ws/my-tasks");
    expect(screen.getByRole("link", { name: "nav.menu:documents" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("active Tab 图标与文字用 accent，非 active 用 muted", () => {
    render(<MobileBottomNav />);
    const activeLink = screen.getByRole("link", { name: "nav.menu:myTasks" });
    const inactiveLink = screen.getByRole("link", { name: "nav.menu:messages" });
    expect(activeLink.innerHTML).toContain("text-[var(--accent)]");
    expect(inactiveLink.innerHTML).toContain("text-[var(--muted)]");
  });

  it("工作区根路径 /w/{wid} → 无 Tab 命中（不误判高亮）", () => {
    SET_PATH("/w/ws-1");
    render(<MobileBottomNav />);
    expect(
      screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page"),
    ).toHaveLength(0);
  });
});
