// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { forwardRef } from "react";

/**
 * UserMenu 契约（components/UserMenu.tsx）：
 *  - 头像按钮（aria-label=nav:user.profile）：点击开合下拉 role=menu
 *  - 头像：user.image → img；否则姓名/邮箱首字母大写；header 显示 name || email 前缀 + email
 *  - 设置入口：/w/{wid}/settings，点击关闭菜单；打开菜单自动聚焦它
 *  - 语言：locales 全集按钮，当前 locale aria-current=true；点击其他 → router.replace(pathname,{locale})
 *  - 主题：3 按钮（nav:theme.system/light/dark），当前 aria-current；点击 applyTheme（data-theme + localStorage）
 *  - 退出：点击关闭菜单并调 onLogout（useTransition 防重）
 *  - Esc / 点击外部关闭；Tab 焦点循环（末→首）
 */

const h = vi.hoisted(() => ({
  locale: "zh",
  pathname: "/w/ws-1/board",
  replace: vi.fn(),
}));

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
  return { useTranslations, useLocale: () => h.locale };
});

// 路由层：Link 需要 forwardRef 转发（设置入口挂 firstFocusableRef）
vi.mock("@/lib/i18n-navigation", () => ({
  Link: forwardRef<
    HTMLAnchorElement,
    { href: string; children?: React.ReactNode; [k: string]: unknown }
  >(
    // 索引签名会让解构出的具名属性退化为 unknown，先整包断言再取字段
    function MockLink(props, ref) {
      const { href, children } = props as { href: string; children?: React.ReactNode };
      const { href: _h, children: _c, ...rest } = props;
      return (
        <a href={href} ref={ref} {...(rest as React.ComponentProps<"a">)}>
          {children}
        </a>
      );
    },
  ),
  usePathname: () => h.pathname,
  useRouter: () => ({ replace: h.replace }),
}));

import { UserMenu } from "@/components/UserMenu";

const USER = { name: "ada", email: "ada@example.com", image: null as string | null };

// 本仓 vitest jsdom 不提供 localStorage（theme-toggle.test.tsx 同坑）：装最小内存实现
let store: Map<string, string>;
beforeEach(() => {
  h.replace.mockReset();
  h.locale = "zh";
  store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  // 本仓 jsdom 无 matchMedia（applyTheme 的 system 分支需要）：最小桩
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  // 本仓 jsdom 无 requestAnimationFrame：立即执行，焦点断言确定性
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderMenu(
  props: {
    user?: { name: string | null; email: string; image: string | null };
    wid?: string;
    onLogout?: () => void;
  } = {},
) {
  return render(
    <UserMenu
      user={props.user ?? USER}
      wid={props.wid ?? "ws-1"}
      onLogout={props.onLogout ?? vi.fn()}
    />,
  );
}

const openMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: "nav:user.profile" }));
};

describe("UserMenu", () => {
  it("关闭态：头像按钮 aria-haspopup/aria-expanded 正确，菜单不存在", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "nav:user.profile" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("点击头像 → 菜单打开（role=menu），显示用户名与邮箱", () => {
    renderMenu();
    openMenu();
    const trigger = screen.getByRole("button", { name: "nav:user.profile" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("ada")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("再次点击头像 → 菜单关闭", () => {
    renderMenu();
    openMenu();
    openMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("name 为空 → header 显示邮箱前缀；无 image → 渲染首字母大写", () => {
    renderMenu({ user: { name: null, email: "wang.wei@corp.io", image: null } });
    openMenu();
    expect(screen.getByText("wang.wei")).toBeInTheDocument();
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("有 image → 渲染 img（无首字母占位）", () => {
    renderMenu({ user: { ...USER, image: "https://cdn.example.com/a.png" } });
    openMenu();
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://cdn.example.com/a.png");
    expect(screen.queryByText("A")).not.toBeInTheDocument();
  });

  it("设置入口：href=/w/{wid}/settings，点击后菜单关闭", () => {
    renderMenu({ wid: "ws-9" });
    openMenu();
    const link = screen.getByRole("link", { name: "nav:user.profile" });
    expect(link).toHaveAttribute("href", "/w/ws-9/settings");
    fireEvent.click(link);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("语言区：渲染全部 locale 名，当前 locale aria-current=true", () => {
    renderMenu();
    openMenu();
    const zh = screen.getByRole("button", { name: "中文" });
    const en = screen.getByRole("button", { name: "English" });
    expect(zh).toHaveAttribute("aria-current", "true");
    expect(en).not.toHaveAttribute("aria-current");
  });

  it("点击其他语言 → router.replace(pathname,{locale})；点击当前语言不导航", () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(h.replace).toHaveBeenCalledWith("/w/ws-1/board", { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(h.replace).toHaveBeenCalledTimes(1);
  });

  it("主题区：3 个按钮走 nav:theme.* 文案，默认 system 高亮", () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole("button", { name: "nav:theme.system" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "nav:theme.light" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("button", { name: "nav:theme.dark" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("点击 light 主题 → data-theme=light + localStorage 持久化 + 高亮切换", () => {
    renderMenu();
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "nav:theme.light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("corps_theme")).toBe("light");
    expect(screen.getByRole("button", { name: "nav:theme.light" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("localStorage 预置 dark → 初始 dark 高亮（挂载后同步 readThemePref）", () => {
    localStorage.setItem("corps_theme", "dark");
    renderMenu();
    openMenu();
    expect(screen.getByRole("button", { name: "nav:theme.dark" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: "nav:theme.system" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("Esc 关闭菜单；点击菜单外 mousedown 关闭，菜单内不关闭", () => {
    renderMenu();
    openMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    openMenu();
    fireEvent.mouseDown(screen.getByText("ada@example.com"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("退出：菜单关闭 + onLogout 调用", async () => {
    const onLogout = vi.fn();
    renderMenu({ onLogout });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "nav:user.logout" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  it("焦点循环：焦点在最后一个元素（退出）按 Tab 跳回第一个（设置链接）", () => {
    renderMenu();
    openMenu();
    const first = screen.getByRole("link", { name: "nav:user.profile" });
    const last = screen.getByRole("button", { name: "nav:user.logout" });
    expect(first).toHaveFocus(); // 打开菜单自动聚焦第一个可聚焦元素
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(first).toHaveFocus();
  });
});
