// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ThemeToggle, applyTheme, readThemePref, resolveTheme } from "@/components/ThemeToggle";

/**
 * 主题切换契约（components/ThemeToggle.tsx）：
 *  - readThemePref：SSR→system；localStorage 只认 light/dark；其余（含非法值）→system
 *  - resolveTheme：system 时按 matchMedia(prefers-color-scheme) 解析；显式偏好直返
 *  - applyTheme：写 documentElement[data-theme] + 持久化插值串；返回解析后的主题
 *  - ThemeToggle：图标随偏好变化（Monitor/Sun/Moon）、title/aria-label 走 theme 命名空间、
 *    点击按 system→light→dark→system 循环回调
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

const THEME_KEY = "corps_" + "theme";

const mockMatchMedia = (dark: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("dark") ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
};

// 本仓 vitest jsdom 不提供 localStorage（存量 sync 测试同坑）：装最小内存实现
let store: Map<string, string>;
beforeEach(() => {
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
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readThemePref / resolveTheme / applyTheme", () => {
  it("readThemePref：无存储/非法值 → system；light/dark 原样", () => {
    expect(readThemePref()).toBe("system");
    localStorage.setItem(THEME_KEY, "light");
    expect(readThemePref()).toBe("light");
    localStorage.setItem(THEME_KEY, "dark");
    expect(readThemePref()).toBe("dark");
    localStorage.setItem(THEME_KEY, "neon");
    expect(readThemePref()).toBe("system");
  });

  it("readThemePref：无 window（SSR）→ system", () => {
    vi.stubGlobal("window", undefined);
    expect(readThemePref()).toBe("system");
  });

  it("resolveTheme：system 跟随 matchMedia；显式直返", () => {
    mockMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
    mockMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("applyTheme：写 data-theme + 持久化偏好（存 pref 而非 resolved）+ 返回 resolved", () => {
    mockMatchMedia(true);
    const resolved = applyTheme("system");
    expect(resolved).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("system"); // 存偏好，不存解析值

    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });
});

describe("ThemeToggle 组件", () => {
  it("图标随偏好切换：system→Monitor、light→Sun、dark→Moon", () => {
    const s = render(<ThemeToggle pref="system" onChange={vi.fn()} />);
    expect(s.container.querySelector("svg.lucide-monitor")).toBeTruthy();
    s.unmount();
    const l = render(<ThemeToggle pref="light" onChange={vi.fn()} />);
    expect(l.container.querySelector("svg.lucide-sun")).toBeTruthy();
    l.unmount();
    const d = render(<ThemeToggle pref="dark" onChange={vi.fn()} />);
    expect(d.container.querySelector("svg.lucide-moon")).toBeTruthy();
  });

  it("title/aria-label 走 theme 命名空间（含当前标签）", () => {
    const { getByRole } = render(<ThemeToggle pref="light" onChange={vi.fn()} />);
    const btn = getByRole("button");
    expect(btn.getAttribute("title")).toBe("theme:light");
    expect(btn.getAttribute("aria-label")).toBe('theme:toggleAria:{"label":"theme:light"}');
  });

  it("点击按 system→light→dark→system 循环", () => {
    const onChange = vi.fn();
    const s = render(<ThemeToggle pref="system" onChange={onChange} />);
    fireEvent.click(s.getByRole("button"));
    expect(onChange).toHaveBeenLastCalledWith("light");
    s.unmount();
    onChange.mockClear();
    const l = render(<ThemeToggle pref="light" onChange={onChange} />);
    fireEvent.click(l.getByRole("button"));
    expect(onChange).toHaveBeenLastCalledWith("dark");
    l.unmount();
    onChange.mockClear();
    const d = render(<ThemeToggle pref="dark" onChange={onChange} />);
    fireEvent.click(d.getByRole("button"));
    expect(onChange).toHaveBeenLastCalledWith("system");
  });
});
