// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * PwaRegister 契约（components/pwa/PwaRegister.tsx）：
 *  1. 非 production 环境不注册 SW
 *  2. production + serviceWorker → register("/sw.js")
 *  3. /auth/* 路由进入时调用 clearAppCaches()（只删 corps-sw* 前缀）
 *  4. beforeinstallprompt → 安装横条（role=dialog，installPrompt 文案 + install/dismiss 按钮）
 *  5. 点 install → prompt() 后隐藏；点 dismiss → 隐藏；appinstalled → 隐藏
 *  6. 卸载时移除两个事件监听
 *  7. clearAppCaches：无 caches / 只删本应用前缀
 */

const mocks = vi.hoisted(() => ({
  register: vi.fn(() => Promise.resolve()),
  pushSupported: vi.fn(),
  cachesKeys: vi.fn(),
  cachesDelete: vi.fn(),
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
  return { useTranslations };
});
// 子组件与本文件契约无关，stub 掉减少耦合
vi.mock("@/components/pwa/PushSubscribe", () => ({
  PushSubscribe: () => <div data-testid="push-subscribe" />,
}));

import { PwaRegister, clearAppCaches } from "@/components/pwa/PwaRegister";

/** 安装 serviceWorker 桩 */
function installSw() {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: mocks.register },
  });
}
function uninstallSw() {
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
}

/** 构造 beforeinstallprompt 事件 */
function installPromptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt");
  Object.assign(event, {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  });
  return event;
}

function installCaches(keys: string[]) {
  mocks.cachesKeys.mockResolvedValue(keys);
  Object.defineProperty(window, "caches", {
    configurable: true,
    value: { keys: mocks.cachesKeys, delete: mocks.cachesDelete },
  });
}
function uninstallCaches() {
  delete (window as unknown as Record<string, unknown>).caches;
}

beforeEach(() => {
  mocks.register.mockReset();
  mocks.register.mockResolvedValue(undefined);
  mocks.cachesKeys.mockReset();
  mocks.cachesDelete.mockReset();
  mocks.cachesDelete.mockResolvedValue(true);
  vi.stubEnv("NODE_ENV", "production");
  installSw();
});
afterEach(() => {
  cleanup();
  uninstallSw();
  uninstallCaches();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("PwaRegister", () => {
  it("非 production 环境 → 不注册 SW", () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<PwaRegister />);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("production → 注册 /sw.js", () => {
    render(<PwaRegister />);
    expect(mocks.register).toHaveBeenCalledWith("/sw.js");
  });

  it("无 serviceWorker 支持 → 不注册且不崩", () => {
    uninstallSw();
    render(<PwaRegister />);
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("/auth/ 路由 → 清理应用缓存；其他路由不清理", async () => {
    installCaches(["corps-sw-v1", "other-app"]);
    window.history.pushState({}, "", "/auth/login");
    mocks.cachesKeys.mockClear();
    render(<PwaRegister />);
    // clearAppCaches 是 fire-and-forget，等一拍
    await waitFor(() => expect(mocks.cachesKeys).toHaveBeenCalled());
    expect(mocks.cachesDelete).toHaveBeenCalledWith("corps-sw-v1");
    expect(mocks.cachesDelete).not.toHaveBeenCalledWith("other-app");

    cleanup();
    window.history.pushState({}, "", "/w/ws-1/documents");
    mocks.cachesKeys.mockClear();
    mocks.cachesDelete.mockClear();
    render(<PwaRegister />);
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.cachesKeys).not.toHaveBeenCalled();
  });

  it("beforeinstallprompt → 渲染安装横条（含子组件 PushSubscribe）", () => {
    render(<PwaRegister />);
    expect(screen.queryByRole("dialog", { name: "pwa:installPrompt" })).toBeFalsy();

    fireEvent(window, installPromptEvent());
    const dialog = screen.getByRole("dialog", { name: "pwa:installPrompt" });
    expect(dialog).toHaveTextContent("pwa:installPrompt");
    expect(screen.getByRole("button", { name: "pwa:install" })).toBeInTheDocument();
    expect(screen.getByTestId("push-subscribe")).toBeInTheDocument();
  });

  it("点 install → 调用 prompt() 并隐藏横条", async () => {
    render(<PwaRegister />);
    const event = installPromptEvent("accepted");
    fireEvent(window, event);

    fireEvent.click(screen.getByRole("button", { name: "pwa:install" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeFalsy());
    expect((event as unknown as { prompt: () => Promise<void> }).prompt).toHaveBeenCalledTimes(1);
  });

  it("prompt() 抛错 → 静默并隐藏", async () => {
    render(<PwaRegister />);
    const event = new Event("beforeinstallprompt");
    const prompt = vi.fn(() => Promise.reject(new Error("already installed")));
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) });
    fireEvent(window, event);

    fireEvent.click(screen.getByRole("button", { name: "pwa:install" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeFalsy());
    expect(prompt).toHaveBeenCalled();
  });

  it("dismiss → 隐藏横条", () => {
    render(<PwaRegister />);
    fireEvent(window, installPromptEvent());
    fireEvent.click(screen.getByRole("button", { name: "pwa:dismiss" }));
    expect(screen.queryByRole("dialog")).toBeFalsy();
  });

  it("appinstalled → 隐藏横条", () => {
    render(<PwaRegister />);
    fireEvent(window, installPromptEvent());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent(window, new Event("appinstalled"));
    expect(screen.queryByRole("dialog")).toBeFalsy();
  });

  it("卸载时移除 beforeinstallprompt / appinstalled 监听（不再响应）", () => {
    const { unmount } = render(<PwaRegister />);
    unmount();

    expect(() => fireEvent(window, installPromptEvent())).not.toThrow();
    expect(screen.queryByRole("dialog")).toBeFalsy();
  });

  it("clearAppCaches：只删除 corps-sw* 前缀，忽略其他来源", async () => {
    installCaches(["corps-sw-v3", "corps-sw-v4", "workbox-precache", "corps-other"]);
    await clearAppCaches();
    expect(mocks.cachesDelete).toHaveBeenCalledTimes(2);
    expect(mocks.cachesDelete).toHaveBeenCalledWith("corps-sw-v3");
    expect(mocks.cachesDelete).toHaveBeenCalledWith("corps-sw-v4");
  });

  it("clearAppCaches：无 caches 支持时安全返回", async () => {
    await expect(clearAppCaches()).resolves.toBeUndefined();
  });
});
