// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

import { SettingsPreferences } from "@/components/settings/SettingsPreferences";

function seed(entries: Record<string, string>) {
  localStorage.clear();
  for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
}

// 本仓 vitest jsdom 不提供 localStorage（存量 theme-toggle/sync 测试同坑）：装最小内存实现
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
});

function viewButton(id: "board" | "list") {
  return screen.getByRole("button", {
    name: id === "board" ? "settings:viewBoard" : "settings:viewList",
  });
}

function themeButton(id: "light" | "dark" | "system") {
  const name =
    id === "light" ? "theme:themeLight" : id === "dark" ? "theme:themeDark" : "theme:themeSystem";
  return screen.getByRole("button", { name });
}

function densityButton(id: "compact" | "comfortable") {
  return screen.getByRole("button", {
    name: id === "compact" ? "settings:densityCompact" : "settings:densityComfortable",
  });
}

function accentButton(id: "blue" | "green" | "purple" | "orange") {
  return screen.getByRole("button", {
    name: `settings:accent${id[0].toUpperCase()}${id.slice(1)}`,
  });
}

function motionButton(id: "reduced" | "standard" | "enhanced") {
  const names: Record<string, string> = {
    reduced: "settings:motionReduced",
    standard: "settings:motionStandard",
    enhanced: "settings:motionEnhanced",
  };
  return screen.getByRole("button", { name: names[id] });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SettingsPreferences", () => {
  it("渲染六个分区标题", () => {
    render(<SettingsPreferences />);
    for (const heading of [
      "settings:defaultViewTitle",
      "settings:notifTitle",
      "settings:appearanceTitle",
      "settings:density",
      "settings:accentColor",
      "settings:motion",
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("空存储下全部回落默认值", () => {
    render(<SettingsPreferences />);
    expect(viewButton("board").className).toContain("bg-[var(--accent-soft)]");
    expect(viewButton("list").className).not.toContain("bg-[var(--accent-soft)]");
    expect(themeButton("system").style.borderColor).toBe("var(--accent)");
    expect(densityButton("compact").style.borderColor).toBe("var(--accent)");
    expect(accentButton("blue")).toHaveAttribute("aria-pressed", "true");
    expect(motionButton("standard")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/settings:notifEmail/)).toBeChecked();
    expect(screen.getByLabelText(/settings:notifMention/)).toBeChecked();
  });

  it("已存偏好全部被尊重", () => {
    seed({
      corps_theme: "dark",
      corps_default_view: "list",
      corps_density: "comfortable",
      corps_accent_color: "purple",
      corps_motion: "reduced",
      corps_notif_pref: JSON.stringify({ emailEnabled: false, mentionEnabled: false }),
    });
    render(<SettingsPreferences />);
    expect(viewButton("list").className).toContain("bg-[var(--accent-soft)]");
    expect(themeButton("dark").style.borderColor).toBe("var(--accent)");
    expect(densityButton("comfortable").style.borderColor).toBe("var(--accent)");
    expect(accentButton("purple")).toHaveAttribute("aria-pressed", "true");
    expect(motionButton("reduced")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/settings:notifEmail/)).not.toBeChecked();
    expect(screen.getByLabelText(/settings:notifMention/)).not.toBeChecked();
  });

  it("非法存储值回落默认", () => {
    seed({
      corps_theme: "banana",
      corps_default_view: "x",
      corps_density: "zz",
      corps_accent_color: "red",
      corps_motion: "fast",
    });
    render(<SettingsPreferences />);
    expect(viewButton("board").className).toContain("bg-[var(--accent-soft)]");
    expect(themeButton("system").style.borderColor).toBe("var(--accent)");
    expect(densityButton("compact").style.borderColor).toBe("var(--accent)");
    expect(accentButton("blue")).toHaveAttribute("aria-pressed", "true");
    expect(motionButton("standard")).toHaveAttribute("aria-pressed", "true");
  });

  it("通知偏好非法 JSON → 全默认开", () => {
    seed({ corps_notif_pref: "not-json" });
    render(<SettingsPreferences />);
    expect(screen.getByLabelText(/settings:notifEmail/)).toBeChecked();
    expect(screen.getByLabelText(/settings:notifMention/)).toBeChecked();
  });

  it("通知偏好部分键缺失 → 缺失键回默认", () => {
    seed({ corps_notif_pref: JSON.stringify({ emailEnabled: false }) });
    render(<SettingsPreferences />);
    expect(screen.getByLabelText(/settings:notifEmail/)).not.toBeChecked();
    expect(screen.getByLabelText(/settings:notifMention/)).toBeChecked();
  });

  it("切换默认视图写入 localStorage 并更新激活态", () => {
    render(<SettingsPreferences />);
    fireEvent.click(viewButton("list"));
    expect(localStorage.getItem("corps_default_view")).toBe("list");
    expect(viewButton("list").className).toContain("bg-[var(--accent-soft)]");
    expect(viewButton("board").className).not.toContain("bg-[var(--accent-soft)]");
  });

  it("切换浅色/深色主题写 data-theme 与 localStorage", () => {
    render(<SettingsPreferences />);
    fireEvent.click(themeButton("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("corps_theme")).toBe("light");
    fireEvent.click(themeButton("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("corps_theme")).toBe("dark");
  });

  it("system 主题经 matchMedia 解析（dark → dark，非 dark → light）", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q }));
    render(<SettingsPreferences />);
    fireEvent.click(themeButton("system"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("corps_theme")).toBe("system");
    vi.unstubAllGlobals();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
    fireEvent.click(themeButton("light"));
    fireEvent.click(themeButton("system"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("切换密度写 data-density 与 localStorage", () => {
    render(<SettingsPreferences />);
    fireEvent.click(densityButton("comfortable"));
    expect(document.documentElement.getAttribute("data-density")).toBe("comfortable");
    expect(localStorage.getItem("corps_density")).toBe("comfortable");
    expect(densityButton("comfortable").style.borderColor).toBe("var(--accent)");
  });

  it("切换强调色写 data-accent-color 与 localStorage 并切换 aria-pressed", () => {
    render(<SettingsPreferences />);
    fireEvent.click(accentButton("purple"));
    expect(document.documentElement.getAttribute("data-accent-color")).toBe("purple");
    expect(localStorage.getItem("corps_accent_color")).toBe("purple");
    expect(accentButton("purple")).toHaveAttribute("aria-pressed", "true");
    expect(accentButton("blue")).toHaveAttribute("aria-pressed", "false");
  });

  it("切动画档写 data-motion 与 localStorage", () => {
    render(<SettingsPreferences />);
    fireEvent.click(motionButton("enhanced"));
    expect(document.documentElement.getAttribute("data-motion")).toBe("enhanced");
    expect(localStorage.getItem("corps_motion")).toBe("enhanced");
    expect(motionButton("enhanced")).toHaveAttribute("aria-pressed", "true");
  });

  it("通知勾选即时持久化", () => {
    render(<SettingsPreferences />);
    fireEvent.click(screen.getByLabelText(/settings:notifEmail/));
    const stored = JSON.parse(localStorage.getItem("corps_notif_pref") ?? "{}");
    expect(stored).toEqual({ emailEnabled: false, mentionEnabled: true });
    expect(screen.getByLabelText(/settings:notifEmail/)).not.toBeChecked();
    expect(screen.getByLabelText(/settings:notifMention/)).toBeChecked();
  });

  it("theme 与 settings 两命名空间的文案键各自独立", () => {
    render(<SettingsPreferences />);
    expect(screen.getByText("theme:themeLight")).toBeInTheDocument();
    expect(screen.getByText("theme:themeDark")).toBeInTheDocument();
    expect(screen.getByText("theme:themeSystem")).toBeInTheDocument();
    expect(screen.getByText("settings:notifEmail")).toBeInTheDocument();
    expect(screen.getByText("settings:notifMention")).toBeInTheDocument();
  });
});
