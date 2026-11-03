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

/** SignalingClient 的替身：记录实例、可手动派发信令消息 */
const sig = vi.hoisted(() => ({
  instances: [] as Array<{
    options: { workspaceId: string };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    handlers: Array<(msg: unknown) => void>;
  }>,
}));
vi.mock("@/lib/webrtc/signaling", () => {
  class SignalingClient {
    options: { workspaceId: string };
    handlers: Array<(msg: unknown) => void> = [];
    connect = vi.fn(async () => {});
    disconnect = vi.fn();
    constructor(options: { workspaceId: string }) {
      this.options = options;
      sig.instances.push(this as never);
    }
    onMessage(fn: (msg: unknown) => void) {
      this.handlers.push(fn);
      return vi.fn();
    }
  }
  return { SignalingClient };
});

import { RemoteControlPanel } from "@/components/remote-control/RemoteControlPanel";

const ME = "u-me";
const SESSIONS_PATH = "/api/v1/remote-control?workspaceId=ws-1";
const MEMBERS_PATH = "/api/v1/workspaces/ws-1/members?limit=100";

const sessions = [
  {
    id: "s-1",
    workspaceId: "ws-1",
    initiatorId: ME,
    targetId: "u-2",
    status: "pending",
    endReason: null,
    expiresAt: "2026-11-03T10:00:00Z",
    acceptedAt: null,
    endedAt: null,
    createdAt: "2026-11-03T09:00:00Z",
    updatedAt: "2026-11-03T09:00:00Z",
  },
  {
    id: "s-2",
    workspaceId: "ws-1",
    initiatorId: "u-3",
    targetId: ME,
    status: "pending",
    endReason: null,
    expiresAt: "2026-11-03T10:00:00Z",
    acceptedAt: null,
    endedAt: null,
    createdAt: "2026-11-03T09:00:00Z",
    updatedAt: "2026-11-03T09:00:00Z",
  },
  {
    id: "s-3",
    workspaceId: "ws-1",
    initiatorId: "u-3",
    targetId: ME,
    status: "active",
    endReason: null,
    expiresAt: "2026-11-03T10:00:00Z",
    acceptedAt: "2026-11-03T09:05:00Z",
    endedAt: null,
    createdAt: "2026-11-03T09:00:00Z",
    updatedAt: "2026-11-03T09:05:00Z",
  },
  {
    id: "s-4",
    workspaceId: "ws-1",
    initiatorId: "u-9",
    targetId: "u-9",
    status: "rejected",
    endReason: "rejected",
    expiresAt: "2026-11-03T10:00:00Z",
    acceptedAt: null,
    endedAt: "2026-11-03T09:02:00Z",
    createdAt: "2026-11-03T09:00:00Z",
    updatedAt: "2026-11-03T09:02:00Z",
  },
];

const members = {
  items: [
    { userId: ME, name: "Me", email: "me@example.com", image: null, role: "owner" },
    { userId: "u-2", name: null, email: "two@example.com", image: null, role: "member" },
    { userId: "u-3", name: "Carol", email: "carol@example.com", image: null, role: "member" },
  ],
};

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function sessionsGetCalls() {
  return mocks.api.mock.calls.filter(([p]) => p === SESSIONS_PATH);
}

function defaultApi(list: unknown[] = sessions) {
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (path === SESSIONS_PATH) return list;
    if (path === MEMBERS_PATH) return members;
    if (opts?.method === "PATCH" || opts?.method === "POST") return {};
    return {};
  });
}

function renderPanel(overrides: Partial<Parameters<typeof RemoteControlPanel>[0]> = {}) {
  const props = {
    workspaceId: "ws-1",
    currentUserId: ME,
    ...overrides,
  };
  const utils = render(<RemoteControlPanel {...props} />);
  return { ...utils, ...props };
}

async function renderLoaded(overrides: Partial<Parameters<typeof RemoteControlPanel>[0]> = {}) {
  const utils = renderPanel(overrides);
  await waitFor(() => expect(screen.getByText("remoteControl:title")).toBeInTheDocument());
  return utils;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sig.instances.length = 0;
});

describe("RemoteControlPanel", () => {
  it("加载中显示 connecting，并拉会话（裸数组）与成员（信封）", async () => {
    defaultApi();
    renderPanel();
    expect(screen.getByText("remoteControl:connecting")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("remoteControl:title")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledWith(SESSIONS_PATH);
    expect(mocks.api).toHaveBeenCalledWith(MEMBERS_PATH);
  });

  it("三个分组各自带计数，rejected 不入任何分组", async () => {
    defaultApi();
    await renderLoaded();

    expect(screen.getByText("remoteControl:incoming · 1")).toBeInTheDocument();
    expect(screen.getByText("remoteControl:outgoing · 1")).toBeInTheDocument();
    expect(screen.getByText("remoteControl:active · 1")).toBeInTheDocument();

    // 传出：我是发起方；对方从成员表取名（name 为 null → 邮箱）
    expect(
      screen.getByText(/remoteControl:youAreControlling two@example\.com/),
    ).toBeInTheDocument();
    // 传入 + 活跃两条里我都是目标方（otherName 同为 Carol）
    expect(screen.getAllByText(/remoteControl:beingControlled Carol/)).toHaveLength(2);
    expect(screen.getAllByText("remoteControl:waitingForAccept")).toHaveLength(2);
    expect(screen.getByText("remoteControl:connected")).toBeInTheDocument();
    expect(screen.queryByText(/remoteControl:requestRejected/)).not.toBeInTheDocument();
  });

  it("会话为空时显示空态", async () => {
    defaultApi([]);
    await renderLoaded();
    expect(screen.getByText("remoteControl:noActiveSessions")).toBeInTheDocument();
  });

  it("发起请求：成员下拉排除自己，选中后 POST 载荷并收起面板重拉列表", async () => {
    defaultApi();
    await renderLoaded();
    expect(sessionsGetCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "remoteControl:request" }));
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "remoteControl:selectUser",
      "two@example.com",
      "Carol",
    ]);

    // 面板内提交按钮与头部按钮同名，取面板里那个（DOM 序最后一个）
    const submitButtons = screen.getAllByRole("button", { name: "remoteControl:request" });
    const submit = submitButtons[submitButtons.length - 1];
    expect(submit).toBeDisabled();

    fireEvent.change(select, { target: { value: "u-3" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(sessionsGetCalls()).toHaveLength(2));
    const post = mocks.api.mock.calls.find(([, o]) => o?.method === "POST");
    expect(post?.[0]).toBe("/api/v1/remote-control");
    expect(bodyOf(post ?? [])).toEqual({ targetUserId: "u-3", workspaceId: "ws-1" });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("选择面板可由取消按钮收起并清空已选", async () => {
    defaultApi();
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "remoteControl:request" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "u-3" } });
    fireEvent.click(screen.getByRole("button", { name: "remoteControl:no" }));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "remoteControl:request" }));
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("接受：PATCH accept 后就位替换；发起方是自己且变 active 时回调 onActiveSession", async () => {
    mocks.api.mockImplementation(async (path: string, _opts?: RequestInit) => {
      if (path === SESSIONS_PATH) return sessions;
      if (path === MEMBERS_PATH) return members;
      // 让 accept 的响应把发起方标成「我」，从而触发查看器回调
      return { ...sessions[2], id: "s-2", initiatorId: ME, status: "active" };
    });
    const onActiveSession = vi.fn();
    await renderLoaded({ onActiveSession });

    fireEvent.click(screen.getAllByTitle("remoteControl:accept")[0]);
    await waitFor(() => expect(onActiveSession).toHaveBeenCalledTimes(1));

    const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/v1/remote-control/s-2?workspaceId=ws-1");
    expect(bodyOf(patch ?? [])).toEqual({ action: "accept" });
    expect(onActiveSession.mock.calls[0][0]).toEqual(
      expect.objectContaining({ id: "s-2", status: "active" }),
    );
  });

  it("接受传入请求但不满足发起方条件时不回调", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (path === SESSIONS_PATH) return sessions;
      if (path === MEMBERS_PATH) return members;
      if (opts?.method === "PATCH") return { ...sessions[2], id: "s-2", status: "active" };
      return {};
    });
    const onActiveSession = vi.fn();
    await renderLoaded({ onActiveSession });

    fireEvent.click(screen.getAllByTitle("remoteControl:accept")[0]);
    await waitFor(() =>
      expect(mocks.api.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(true),
    );
    expect(onActiveSession).not.toHaveBeenCalled();
    // 列表更新为 active：出现结束按钮
    expect(screen.getAllByTitle("remoteControl:end")).toHaveLength(2);
  });

  it("拒绝与结束各自发出对应 action", async () => {
    defaultApi();
    await renderLoaded();

    fireEvent.click(screen.getAllByTitle("remoteControl:reject")[0]);
    await waitFor(() =>
      expect(mocks.api.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(true),
    );
    expect(bodyOf(mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH") ?? [])).toEqual({
      action: "reject",
    });

    fireEvent.click(screen.getAllByTitle("remoteControl:end")[0]);
    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH")).toHaveLength(2),
    );
    const patches = mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH");
    expect(bodyOf(patches[1])).toEqual({ action: "end" });
  });

  it("动作失败：ApiError 显示原文，非 ApiError 回退 failed", async () => {
    mocks.api.mockImplementation(async (path: string, _opts?: RequestInit) => {
      if (path === SESSIONS_PATH) return sessions;
      if (path === MEMBERS_PATH) return members;
      throw new mocks.ApiErrorClass("accept-boom");
    });
    const first = await renderLoaded();
    fireEvent.click(screen.getAllByTitle("remoteControl:accept")[0]);
    await waitFor(() => expect(screen.getByText("accept-boom")).toBeInTheDocument());
    first.unmount();

    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (path === SESSIONS_PATH) return sessions;
      if (path === MEMBERS_PATH) return members;
      if (opts?.method === "PATCH") throw { weird: true };
      return {};
    });
    await renderLoaded();
    fireEvent.click(screen.getAllByTitle("remoteControl:accept")[0]);
    await waitFor(() => expect(screen.getByText("remoteControl:failed")).toBeInTheDocument());
  });

  it("信令消息到达时刷新列表，卸载时断开连接", async () => {
    defaultApi();
    const { unmount } = await renderLoaded();
    expect(sig.instances).toHaveLength(1);
    expect(sig.instances[0].options).toEqual({ workspaceId: "ws-1" });
    expect(sig.instances[0].connect).toHaveBeenCalledTimes(1);
    expect(sessionsGetCalls()).toHaveLength(1);

    await act(async () => {
      sig.instances[0].handlers.forEach((h) => h({ type: "session-updated" }));
    });
    await waitFor(() => expect(sessionsGetCalls()).toHaveLength(2));

    unmount();
    expect(sig.instances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("加载失败静默：控制台记错但仍给出空态", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.api.mockImplementation(async () => {
      throw new Error("list-boom");
    });
    await renderLoaded();

    expect(screen.getByText("remoteControl:noActiveSessions")).toBeInTheDocument();
    expect(errSpy).toHaveBeenCalled();
  });
});
