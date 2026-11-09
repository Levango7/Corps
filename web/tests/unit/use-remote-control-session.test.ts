// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { RemoteControlSessionState } from "@/lib/webrtc/peer-connection";

/**
 * useRemoteControlSession 契约（lib/use-remote-control-session.ts）
 *
 * 这个 hook 是远程控制「媒体层从未接通」的补线：RemoteControlSession 产出
 * SDP/ICE，SignalingClient 搬运消息，此前二者零处互相调用。
 *
 * 钉住四件事：
 *  1. 未启用/缺参数时不建连（不产生任何 WebRTC 或信令对象）
 *  2. 启用后控制方会 initiate()，并把 SDP/ICE 经信令发给正确的对端
 *  3. 对端 answer/ICE 回流到本端 WebRTC；end-control 关闭会话
 *  4. 卸载时断信令 + 关会话（防泄漏）
 */

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn(),
  initiate: vi.fn(),
  accept: vi.fn(),
  handleAnswer: vi.fn(),
  handleIceCandidate: vi.fn(),
  close: vi.fn(),
  onSdpReady: vi.fn(),
  onIceCandidateReady: vi.fn(),
  onMessage: vi.fn(),
}));

vi.mock("@/lib/webrtc/peer-connection", () => {
  class RemoteControlSession {
    initiate = mocks.initiate;
    accept = mocks.accept;
    handleAnswer = mocks.handleAnswer;
    handleIceCandidate = mocks.handleIceCandidate;
    close = mocks.close;
    onSdpReady = mocks.onSdpReady;
    onIceCandidateReady = mocks.onIceCandidateReady;
    constructor(public options: { role: string; sessionId: string }) {}
  }
  return { RemoteControlSession };
});

vi.mock("@/lib/webrtc/signaling", () => {
  class SignalingClient {
    connect = mocks.connect;
    disconnect = mocks.disconnect;
    send = mocks.send;
    onMessage = mocks.onMessage;
    constructor(public options: { workspaceId: string }) {}
  }
  return { SignalingClient };
});

import { useRemoteControlSession } from "@/lib/use-remote-control-session";

const baseOptions = {
  workspaceId: "ws-1",
  sessionId: "sess-1",
  role: "controller" as const,
  selfUserId: "user-self",
  peerUserId: "user-peer",
  enabled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue(undefined);
  mocks.initiate.mockResolvedValue(undefined);
  mocks.handleAnswer.mockResolvedValue(undefined);
  mocks.handleIceCandidate.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue(undefined);
  // onSdpReady/onMessage 默认注册一个空回调，测试时再取回来
  mocks.onSdpReady.mockReturnValue(() => {});
  mocks.onIceCandidateReady.mockReturnValue(() => {});
  mocks.onMessage.mockReturnValue(() => {});
});

afterEach(() => cleanup());

describe("useRemoteControlSession", () => {
  it("未启用时不建连（无信令、无 WebRTC 对象）", () => {
    const { result } = renderHook(() =>
      useRemoteControlSession({ ...baseOptions, enabled: false }),
    );

    expect(result.current).toBeNull();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.initiate).not.toHaveBeenCalled();
  });

  it("缺 sessionId / selfUserId / peerUserId 时不建连", () => {
    const { result: a } = renderHook(() =>
      useRemoteControlSession({ ...baseOptions, sessionId: null }),
    );
    const { result: b } = renderHook(() =>
      useRemoteControlSession({ ...baseOptions, selfUserId: "" }),
    );
    const { result: c } = renderHook(() =>
      useRemoteControlSession({ ...baseOptions, peerUserId: null }),
    );

    expect(a.current).toBeNull();
    expect(b.current).toBeNull();
    expect(c.current).toBeNull();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("启用后控制方建连并 initiate，随后透出 session 实例", async () => {
    const { result } = renderHook(() => useRemoteControlSession(baseOptions));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.initiate).toHaveBeenCalledTimes(1);
    expect(result.current).not.toBeNull();
  });

  it("本端 SDP 经信令发给对端（from=自己、to=对端、带 workspaceId）", async () => {
    let sdpCallback: ((sdp: string, type: "offer" | "answer") => void) | null = null;
    mocks.onSdpReady.mockImplementation((cb) => {
      sdpCallback = cb;
      return () => {};
    });

    renderHook(() => useRemoteControlSession(baseOptions));

    await act(async () => {
      sdpCallback?.("v=0...", "offer");
      await Promise.resolve();
    });

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "offer",
        fromUserId: "user-self",
        toUserId: "user-peer",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        sdp: "v=0...",
      }),
    );
  });

  it("本端 ICE 经信令发给对端", async () => {
    let iceCallback: ((candidate: unknown) => void) | null = null;
    mocks.onIceCandidateReady.mockImplementation((cb) => {
      iceCallback = cb;
      return () => {};
    });

    renderHook(() => useRemoteControlSession(baseOptions));

    const candidate = { candidate: "cand", sdpMid: null, sdpMLineIndex: null };
    await act(async () => {
      iceCallback?.(candidate);
      await Promise.resolve();
    });

    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ice-candidate",
        fromUserId: "user-self",
        toUserId: "user-peer",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        candidate,
      }),
    );
  });

  it("对端 answer 回流到本端 WebRTC（控制方）", async () => {
    let messageCallback: ((msg: Record<string, unknown>) => void) | null = null;
    mocks.onMessage.mockImplementation((cb) => {
      messageCallback = cb;
      return () => {};
    });

    renderHook(() => useRemoteControlSession(baseOptions));

    await act(async () => {
      messageCallback?.({
        type: "answer",
        fromUserId: "user-peer",
        toUserId: "user-self",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        sdp: "v=0 answer",
      });
      await Promise.resolve();
    });

    expect(mocks.handleAnswer).toHaveBeenCalledWith("v=0 answer");
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it("其它会话的消息被忽略（sessionId 过滤）", async () => {
    let messageCallback: ((msg: Record<string, unknown>) => void) | null = null;
    mocks.onMessage.mockImplementation((cb) => {
      messageCallback = cb;
      return () => {};
    });

    renderHook(() => useRemoteControlSession(baseOptions));

    await act(async () => {
      messageCallback?.({
        type: "answer",
        sessionId: "other-session",
        sdp: "v=0",
      });
      await Promise.resolve();
    });

    expect(mocks.handleAnswer).not.toHaveBeenCalled();
  });

  it("end-control 关闭本会话", async () => {
    let messageCallback: ((msg: Record<string, unknown>) => void) | null = null;
    mocks.onMessage.mockImplementation((cb) => {
      messageCallback = cb;
      return () => {};
    });

    renderHook(() => useRemoteControlSession(baseOptions));

    await act(async () => {
      messageCallback?.({ type: "end-control", sessionId: "sess-1" });
    });

    expect(mocks.close).toHaveBeenCalled();
  });

  it("卸载时断信令 + 关会话（防泄漏）", async () => {
    const { unmount } = renderHook(() => useRemoteControlSession(baseOptions));

    await act(async () => {
      await Promise.resolve();
    });
    const closeSpy = mocks.close;
    const disconnectSpy = mocks.disconnect;

    act(() => {
      unmount();
    });

    expect(disconnectSpy).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalled();
  });
});
