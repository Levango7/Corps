// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

/**
 * ws-client 连续失败上限回归测试。
 *
 * 背景：本部署不具备 WebSocket 能力（Next.js standalone server 不处理 upgrade），
 * 握手恒失败。原实现的重连次数**无上限**，于是每个开着的标签页约每 30s 打一次
 * 无意义的失败握手（服务端日志 + 浏览器控制台持续噪音）。
 *
 * 实时性已由 useIM 的 5s 轮询兜底承担（ADR-009 §2.1.1），
 * 因此这里锁定：连续失败达到 MAX_RECONNECT_ATTEMPTS（5）后必须停止重连。
 */

class FailingWebSocket {
  static instances: FailingWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor() {
    FailingWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = FailingWebSocket.CLOSED;
  }
  /** 模拟一次握手失败：先置 CLOSED（真实 WebSocket 关前会改 readyState），再触发 onclose */
  fail(): void {
    this.readyState = FailingWebSocket.CLOSED;
    this.onclose?.({ code: 1006, reason: "" });
  }
}

beforeEach(() => {
  FailingWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FailingWebSocket);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ws-client 连续失败上限（防无限重连）", () => {
  it("连续失败 5 次后停止重连，之后不再新建连接", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { useIMWebSocket } = await import("@/lib/im/ws-client");
    const { result } = renderHook(() => useIMWebSocket("ws-1"));
    await act(async () => {});

    // 挂载即首次连接
    expect(FailingWebSocket.instances.length).toBe(1);

    // 反复「握手失败 → 退避重连」，直到计数到顶
    for (let i = 0; i < 6; i++) {
      const latest = FailingWebSocket.instances[FailingWebSocket.instances.length - 1];
      await act(async () => {
        latest.fail();
        // 退避最长 20.8s（attempt=4 时 16s + 最多 4.8s 抖动），推进 40s 足够
        await vi.advanceTimersByTimeAsync(40_000);
      });
    }

    // 1 次首发 + 5 次退避重连 = 6；此后应停止
    expect(FailingWebSocket.instances.length).toBe(6);

    // 再推 5 分钟也不应新建连接（原实现会一直重连下去）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(FailingWebSocket.instances.length).toBe(6);
    expect(result.current.status).toBe("disconnected");

    // "已放弃"的告警应打印且只打印一次
    const gaveUpWarns = warn.mock.calls.filter((c) => String(c[0]).includes("停止重连"));
    expect(gaveUpWarns.length).toBe(1);

    warn.mockRestore();
  });
});
