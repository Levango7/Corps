// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), ApiErrorClass: ApiError };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));

import { RemoteControlDialog } from "@/components/remote-control/RemoteControlDialog";

const PATCH_PATH = "/api/v1/remote-control/s-1?workspaceId=ws-1";

const session = {
  id: "s-1",
  workspaceId: "ws-1",
  initiatorId: "u-initiator-1234567",
  targetId: "u-me",
  status: "pending",
  endReason: null,
  expiresAt: "2026-11-03T10:00:00Z",
  acceptedAt: null,
  endedAt: null,
  createdAt: "2026-11-03T09:00:00Z",
  updatedAt: "2026-11-03T09:00:00Z",
};

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function renderDialog(overrides: Partial<Parameters<typeof RemoteControlDialog>[0]> = {}) {
  const props = {
    session,
    workspaceId: "ws-1",
    requester: undefined,
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const utils = render(<RemoteControlDialog {...props} />);
  return { ...utils, ...props };
}

function defaultApi() {
  mocks.api.mockImplementation(async () => ({ ...session, status: "active" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RemoteControlDialog", () => {
  it("请求者显示名三级回退：name → email → initiatorId 前 8 位", () => {
    defaultApi();
    const first = renderDialog();
    // initiatorId "u-initiator-1234567".slice(0, 8)
    expect(screen.getByText("u-initia")).toBeInTheDocument();
    first.unmount();

    renderDialog({ requester: { id: "u-1", name: null, email: "req@example.com", image: null } });
    // 显示名与下方的邮箱行同文
    expect(screen.getAllByText("req@example.com")).toHaveLength(2);

    cleanup();
    renderDialog({ requester: { id: "u-1", name: "Req", email: "req@example.com", image: null } });
    expect(screen.getAllByText("Req").length).toBeGreaterThanOrEqual(1);
  });

  it("有头像时渲染 img，无头像时渲染首字母占位", () => {
    defaultApi();
    const first = renderDialog({
      requester: { id: "u-1", name: "Req", email: "req@example.com", image: "https://x/y.png" },
    });
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://x/y.png");
    expect(img).toHaveAttribute("alt", "Req");
    first.unmount();

    renderDialog({ requester: { id: "u-1", name: "zoe", email: "zoe@example.com", image: null } });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Z")).toBeInTheDocument();
  });

  it("初始聚焦对话框本体", () => {
    defaultApi();
    renderDialog();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("倒计时从 30 递减，归零自动拒绝", async () => {
    defaultApi();
    vi.useFakeTimers();
    // 每秒一拍：倒计时是 setTimeout 自链（依赖 countdown 重新注册），一次性推进不会连跳
    const tick = async (seconds: number) => {
      for (let i = 0; i < seconds; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
        });
      }
    };
    try {
      const { onReject } = renderDialog();
      expect(screen.getByText("30s")).toBeInTheDocument();

      await tick(5);
      expect(screen.getByText("25s")).toBeInTheDocument();

      await tick(25);
      expect(onReject).toHaveBeenCalledTimes(1);
      const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
      expect(bodyOf(patch ?? [])).toEqual({ action: "reject" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ESC 关闭；遮罩点击关闭；对话框内部点击不关闭", () => {
    defaultApi();
    const { onClose } = renderDialog();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);

    // 遮罩层是 dialog 的父元素：点内部元素冒泡到遮罩时被 stopPropagation 拦下
    fireEvent.click(screen.getByText("remoteControl:incoming"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tab 焦点在对话框内回绕（正向与反向）", () => {
    defaultApi();
    renderDialog();
    const reject = screen.getByRole("button", { name: "remoteControl:reject" });
    const accept = screen.getByRole("button", { name: "remoteControl:accept" });

    accept.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(reject);

    reject.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(accept);
  });

  it("接受：PATCH accept 后回调，不关闭对话框", async () => {
    defaultApi();
    const onAccept = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onAccept, onClose });

    fireEvent.click(screen.getByRole("button", { name: "remoteControl:accept" }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));

    const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(patch?.[0]).toBe(PATCH_PATH);
    expect(bodyOf(patch ?? [])).toEqual({ action: "accept" });
    expect(onAccept.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "s-1" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("接受失败：ApiError 显示原文并恢复按钮可用（不关闭）", async () => {
    mocks.api.mockImplementation(async () => {
      // 该组件只在 ApiError 时透传 message，普通 Error 会回退成 failed 文案
      throw new mocks.ApiErrorClass("accept-boom");
    });
    const { onAccept, onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "remoteControl:accept" }));
    await waitFor(() => expect(screen.getByText("accept-boom")).toBeInTheDocument());

    expect(onAccept).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "remoteControl:accept" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "remoteControl:reject" })).toBeEnabled();
  });

  it("非 ApiError 抛出时回退 failed 文案", async () => {
    mocks.api.mockImplementation(async () => {
      throw { weird: true };
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "remoteControl:accept" }));
    await waitFor(() => expect(screen.getByText("remoteControl:failed")).toBeInTheDocument());
  });

  it("拒绝成功：调用 onReject", async () => {
    defaultApi();
    const { onReject } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "remoteControl:reject" }));
    await waitFor(() => expect(onReject).toHaveBeenCalledTimes(1));
    expect(bodyOf(mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH") ?? [])).toEqual({
      action: "reject",
    });
  });

  it("拒绝失败：记日志并直接关闭（避免卡死）", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.api.mockImplementation(async () => {
      throw new Error("reject-boom");
    });
    const { onReject, onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "remoteControl:reject" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onReject).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it("请求进行中两个按钮都禁用", async () => {
    mocks.api.mockImplementation(() => new Promise<never>(() => {}));
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "remoteControl:accept" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "remoteControl:accept" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "remoteControl:reject" })).toBeDisabled();
  });
});
