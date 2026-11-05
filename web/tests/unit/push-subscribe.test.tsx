// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * PushSubscribe 契约（components/pwa/PushSubscribe.tsx）：
 *  1. 浏览器不支持（缺 Notification / serviceWorker）→ 不渲染
 *  2. 挂载检查已有订阅 → subscribed 状态决定按钮文案 pushOff / pushOn
 *  3. 订阅：GET /api/v1/push/vapid → 取 data.publicKey；缺失 → pushNotConfigured
 *  4. 权限 granted 才继续；POST /api/v1/push/subscribe body=JSON(sub)；code!==200 → pushSubscribeFailed
 *  5. 成功 → subscribed=true；异常 → pushSubscribeFailed
 *  6. 退订：sub.unsubscribe + POST /api/v1/push/unsubscribe body {endpoint}；成功 → subscribed=false
 *  7. loading 期间按钮 disabled
 */

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  requestPermission: vi.fn(),
  getSubscription: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  register: vi.fn(),
  fetch: vi.fn(),
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
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.loggerWarn, error: mocks.loggerError },
}));

import { PushSubscribe } from "@/components/pwa/PushSubscribe";

const VAPID_KEY = "AQIDBA";

/** 安装支持 Push 的浏览器环境（Notification + serviceWorker + pushManager） */
function installPushEnv(options: { existingSub?: unknown } = {}) {
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { requestPermission: mocks.requestPermission },
  });
  const reg = {
    pushManager: {
      getSubscription: mocks.getSubscription,
      subscribe: mocks.subscribe,
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve(reg), register: mocks.register },
  });
  mocks.getSubscription.mockResolvedValue(options.existingSub ?? null);
}

function uninstallPushEnv() {
  delete (window as unknown as Record<string, unknown>).Notification;
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
}

/** fetch 顺序应答助手 */
function fetchSequence(...responses: unknown[]) {
  responses.forEach((r) => {
    mocks.fetch.mockResolvedValueOnce({
      json: () => Promise.resolve(r),
    } as Response);
  });
}

beforeEach(() => {
  mocks.loggerWarn.mockReset();
  mocks.loggerError.mockReset();
  mocks.requestPermission.mockReset();
  mocks.getSubscription.mockReset();
  mocks.subscribe.mockReset();
  mocks.unsubscribe.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  uninstallPushEnv();
  vi.unstubAllGlobals();
});

describe("PushSubscribe", () => {
  it("缺 Notification / serviceWorker → 不渲染", async () => {
    const { container } = render(<PushSubscribe />);
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(container.querySelector("button")).toBeNull();
  });

  it("支持 push 且无已有订阅 → 按钮 pushOn", async () => {
    installPushEnv();
    render(<PushSubscribe />);
    await waitFor(() => expect(mocks.getSubscription).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument();
  });

  it("已有订阅 → 按钮 pushOff", async () => {
    installPushEnv({ existingSub: { endpoint: "https://push.example/1" } });
    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOff" })).toBeInTheDocument(),
    );
  });

  it("getSubscription 抛错 → 静默（保持 pushOn）", async () => {
    installPushEnv();
    mocks.getSubscription.mockRejectedValueOnce(new Error("boom"));
    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("pwa:pushSubscribeFailed")).toBeFalsy();
  });

  it("订阅成功全链路：VAPID → 权限 granted → subscribe → POST 订阅", async () => {
    installPushEnv();
    mocks.requestPermission.mockResolvedValue("granted");
    const sub = { endpoint: "https://push.example/2", keys: { p256dh: "x", auth: "y" } };
    mocks.subscribe.mockResolvedValue(sub);
    fetchSequence({ data: { publicKey: VAPID_KEY } }, { code: 200 });

    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "pwa:pushOn" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOff" })).toBeInTheDocument(),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(1, "/api/v1/push/vapid");
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, "/api/v1/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
    });
    expect(screen.queryByText("pwa:pushNotConfigured")).toBeFalsy();
  });

  it("VAPID 公钥缺失 → pushNotConfigured 提示，不申请权限", async () => {
    installPushEnv();
    fetchSequence({ data: {} });

    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "pwa:pushOn" }));

    await waitFor(() => expect(screen.getByText("pwa:pushNotConfigured")).toBeInTheDocument());
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it("权限非 granted → 中止订阅（不 POST、无错误条）", async () => {
    installPushEnv();
    mocks.requestPermission.mockResolvedValue("denied");
    fetchSequence({ data: { publicKey: VAPID_KEY } });

    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "pwa:pushOn" }));

    await waitFor(() => expect(mocks.requestPermission).toHaveBeenCalled());
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("pwa:pushSubscribeFailed")).toBeFalsy();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOn" })).not.toBeDisabled(),
    );
  });

  it("后端订阅 code!==200 → pushSubscribeFailed", async () => {
    installPushEnv();
    mocks.requestPermission.mockResolvedValue("granted");
    mocks.subscribe.mockResolvedValue({ endpoint: "https://push.example/3" });
    fetchSequence({ data: { publicKey: VAPID_KEY } }, { code: 500 });

    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "pwa:pushOn" }));

    await waitFor(() => expect(screen.getByText("pwa:pushSubscribeFailed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument();
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it("订阅流程抛异常 → pushSubscribeFailed + logger.error", async () => {
    installPushEnv();
    mocks.requestPermission.mockResolvedValue("granted");
    mocks.subscribe.mockRejectedValue(new Error("subscribe boom"));
    fetchSequence({ data: { publicKey: VAPID_KEY } });

    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "pwa:pushOn" }));

    await waitFor(() => expect(screen.getByText("pwa:pushSubscribeFailed")).toBeInTheDocument());
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it("退订：sub.unsubscribe + POST /push/unsubscribe body {endpoint} → pushOn", async () => {
    const sub = { endpoint: "https://push.example/4", unsubscribe: mocks.unsubscribe };
    installPushEnv({ existingSub: sub });
    mocks.unsubscribe.mockResolvedValue(true);
    fetchSequence({ code: 200 });

    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOff" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "pwa:pushOff" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOn" })).toBeInTheDocument(),
    );
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith("/api/v1/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  });

  it("退订接口 code!==200 → 不改变订阅态（保持 pushOff）", async () => {
    const sub = { endpoint: "https://push.example/5", unsubscribe: mocks.unsubscribe };
    installPushEnv({ existingSub: sub });
    mocks.unsubscribe.mockResolvedValue(true);
    fetchSequence({ code: 500 });

    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOff" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "pwa:pushOff" }));

    await waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "pwa:pushOff" })).toBeInTheDocument();
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it("退订抛异常 → 保持订阅态", async () => {
    const sub = { endpoint: "https://push.example/6", unsubscribe: mocks.unsubscribe };
    installPushEnv({ existingSub: sub });
    mocks.unsubscribe.mockRejectedValue(new Error("unsub boom"));

    render(<PushSubscribe />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "pwa:pushOff" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "pwa:pushOff" }));

    await waitFor(() => expect(mocks.loggerError).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "pwa:pushOff" })).toBeInTheDocument();
  });
});
