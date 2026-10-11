// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

/**
 * useIM 轮询兜底回归测试（ADR-009 §2.1.1：MVP 实时方案 = 5s + 游标增量）。
 *
 * 背景：本部署跑的是 Next.js standalone server（`web/docker/entrypoint.sh:70`
 * 的 `exec node server.js`），不处理 WebSocket upgrade —— 实测部署产物
 * `.next/standalone/web/server.js` 里 `upgrade` 出现 0 次。因此 ws-client 的连接
 * 永远建立不起来，`ws.onMessage` 一条也收不到，IM 会退化成
 * 「必须手动刷新才看得到新消息」。
 *
 * 本用例锁定兜底行为：WS 未连接时，每 5s 调 `GET .../messages?after=<最后一条 createdAt>`
 * 增量拉取，并按 id 去重合并。
 */

const { apiMock, apiListMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  apiListMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiList: apiListMock,
}));

/** 永不 onopen 的 WebSocket 替身：模拟「upgrade 恒失败」，使 status 停在 connecting */
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

const CONV = { id: "cid-1", name: "会话", unreadCount: 0 };

function makeMsg(id: string, createdAt: string) {
  return {
    id,
    conversationId: "cid-1",
    authorId: "u-1",
    author: { id: "u-1", name: "甲", email: null, image: null },
    body: id,
    type: "text",
    createdAt,
    editedAt: null,
    revokedAt: null,
    replyToId: null,
    mentions: [],
    attachments: [],
  };
}

const MSG_1 = makeMsg("m1", "2026-10-11T00:00:01.000Z");
/** 轮询"新收到"的那条 */
const MSG_2 = makeMsg("m2", "2026-10-11T00:00:05.000Z");

/** 取出所有 api 调用的 URL 字符串 */
function calledUrls(): string[] {
  return apiMock.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", NeverOpenWebSocket);
  apiListMock.mockResolvedValue([]);
  apiMock.mockImplementation(async (url: string) => {
    if (url.includes("/read")) return null;
    if (url.includes("/messages")) {
      // 带 after 的增量轮询 → 返回"新来的那条"；首次加载 → 返回 m1
      return url.includes("after=")
        ? { messages: [MSG_2], hasMore: false }
        : { messages: [MSG_1], hasMore: false };
    }
    return CONV;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useIM 轮询兜底（WS 不可用时的 ADR-009 实时通道）", () => {
  it("WS 未连接时每 5s 用 ?after= 游标增量拉取，并把新消息合并进列表", async () => {
    const { useIM } = await import("@/components/im/useIM");
    const { result } = renderHook(() => useIM("ws-1"));
    await act(async () => {});

    await act(async () => {
      await result.current.selectConversation("cid-1");
    });
    expect(result.current.messages.map((m) => m.id)).toEqual(["m1"]);

    // 未到 5s 间隔：不应有增量请求
    expect(calledUrls().some((u) => u.includes("after="))).toBe(false);

    // 推进 5s → tick 触发
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const polled = calledUrls().filter((u) => u.includes("after="));
    expect(polled.length).toBeGreaterThan(0);
    // 游标回退 1ms：服务端用 `createdAt > after`（严格大于），
    // 不回退会漏掉与最后一条同毫秒落库的消息
    expect(decodeURIComponent(polled[0])).toContain("after=2026-10-11T00:00:00.999Z");

    expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("重复轮询不会重复追加同一条消息（按 id 去重）", async () => {
    const { useIM } = await import("@/components/im/useIM");
    const { result } = renderHook(() => useIM("ws-1"));
    await act(async () => {});
    await act(async () => {
      await result.current.selectConversation("cid-1");
    });

    // 连续 3 个 tick，mock 每次返回同一条 m2
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
    }

    expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("WS 未连接时轮询会静默刷新会话列表（未读数不能只靠推送）", async () => {
    const { useIM } = await import("@/components/im/useIM");
    const { result } = renderHook(() => useIM("ws-1"));
    await act(async () => {});
    await act(async () => {
      await result.current.selectConversation("cid-1");
    });

    const before = apiListMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(apiListMock.mock.calls.length).toBeGreaterThan(before);
    // 静默刷新不得点亮页面级 loading
    expect(result.current.loading).toBe(false);
  });
});
