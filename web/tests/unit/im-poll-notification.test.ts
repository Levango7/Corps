// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

/**
 * 轮询兜底下的「非活跃会话新消息」通知回归测试。
 *
 * 背景：浏览器通知原本只挂在 `useIM` 的 `ws.onMessage` "message" 分支上，
 * 而 WS 在本部署连不上（Next standalone 不处理 upgrade）→ 该分支永不执行
 * → 非活跃会话的新消息**从不弹通知**。
 * 轮询拿到会话列表后用未读数增量还原该行为。
 *
 * 依赖的既有契约：后端未读口径只统计他人消息
 * （`conversations/route.ts:118` 的 `author_id IS DISTINCT FROM userId`），
 * 且会话列表返回 `lastMessage`（`conversations/route.ts:138`）。
 */

const { apiMock, apiListMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  apiListMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiList: apiListMock,
}));

/** 永不 onopen 的 WebSocket 替身：让轮询通道处于启用状态 */
class NeverOpenWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  send(): void {}
  close(): void {
    this.readyState = NeverOpenWebSocket.CLOSED;
  }
}

class FakeNotification {
  static permission = "granted" as NotificationPermission;
  static instances: FakeNotification[] = [];
  static requestPermission = vi.fn(() => Promise.resolve("granted" as NotificationPermission));
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}

function conv(id: string, unreadCount: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    workspaceId: "ws-1",
    type: "direct",
    title: null,
    avatar: null,
    description: null,
    createdBy: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    lastMessageAt: null,
    members: [],
    unreadCount,
    ...extra,
  };
}

const LAST_MESSAGE = {
  id: "m9",
  body: "新消息",
  type: "text",
  createdAt: "2026-10-11T00:00:05.000Z",
  authorId: "u-2",
  author: { id: "u-2", name: "乙", image: null },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", NeverOpenWebSocket);
  vi.stubGlobal("Notification", FakeNotification);
  FakeNotification.instances = [];
  apiMock.mockImplementation(async (url: string) => {
    if (url.includes("/read")) return null;
    if (url.includes("/messages")) return { messages: [], hasMore: false };
    return conv("cid-1", 0);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("轮询兜底的新消息通知", () => {
  it("非活跃会话未读增加 → 弹通知，文案取 lastMessage", async () => {
    apiListMock
      .mockResolvedValueOnce([conv("cid-1", 0), conv("cid-2", 0, { title: "另一会话" })])
      .mockResolvedValue([
        conv("cid-1", 0),
        conv("cid-2", 2, { title: "另一会话", lastMessage: LAST_MESSAGE }),
      ]);

    const { useIM } = await import("@/components/im/useIM");
    renderHook(() => useIM("ws-1"));
    await act(async () => {});

    // 首次快照只建基线：历史未读不应刷通知
    expect(FakeNotification.instances.length).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(FakeNotification.instances.length).toBe(1);
    expect(FakeNotification.instances[0].title).toBe("乙");
    expect(FakeNotification.instances[0].options?.body).toBe("新消息");
  });

  it("活跃会话未读增加 → 不弹通知", async () => {
    apiListMock
      .mockResolvedValueOnce([conv("cid-1", 0)])
      .mockResolvedValue([conv("cid-1", 3, { lastMessage: LAST_MESSAGE })]);

    const { useIM } = await import("@/components/im/useIM");
    const { result } = renderHook(() => useIM("ws-1"));
    await act(async () => {});

    // 选中 cid-1 使其成为活跃会话
    await act(async () => {
      await result.current.selectConversation("cid-1");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(FakeNotification.instances.length).toBe(0);
  });
});
