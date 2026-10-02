// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

/**
 * IM hook 返回值的引用稳定性回归测试。
 *
 * 背景：TaskChatPanel 用 useEffect(..., [taskId, selectTaskConversation]) 拉取任务会话。
 * 一旦 selectTaskConversation 每次渲染都是新函数，effect 就会「渲染→POST→setState→渲染」
 * 自激，实测一次 E2E 用例里打出 687 次 POST /tasks/{id}/conversation、316 次
 * GET /conversations/{cid}/messages（≈100 req/s），表现为「消息发出去却渲染不出来」的
 * 假抖动。断链点是 ws-client 直接返回对象字面量（每次渲染新建），
 * useIM 的 selectConversation 依赖 [workspaceId, ws] 于是被逐层带崩。
 */

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiList: () => Promise.resolve([]),
}));

/** 不真正联网的 WebSocket 替身：只满足 ws-client 用到的常量与方法 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  send(): void {}
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  apiMock.mockResolvedValue({ messages: [], hasMore: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("IM hook 引用稳定性（防会话拉取 effect 自激）", () => {
  it("useIMWebSocket 在同一组件的多次渲染之间返回同一个对象", async () => {
    const { useIMWebSocket } = await import("@/lib/im/ws-client");
    const { result, rerender } = renderHook(() => useIMWebSocket("ws-1"));
    // 挂载 effect 里的 setStatus("connecting") 是异步落地的，先 flush 再取基准引用，
    // 否则断言比 React 早一步，报 "not wrapped in act"
    await act(async () => {});
    const first = result.current;
    rerender();
    await act(async () => {});
    rerender();
    await act(async () => {});
    expect(result.current).toBe(first);
  });

  it("useIM 在多次渲染之间返回同一个 selectTaskConversation", async () => {
    const { useIM } = await import("@/components/im/useIM");
    const { result, rerender } = renderHook(() => useIM("ws-1"));
    await act(async () => {});
    const first = result.current.selectTaskConversation;
    rerender();
    await act(async () => {});
    rerender();
    await act(async () => {});
    expect(result.current.selectTaskConversation).toBe(first);
  });
});
