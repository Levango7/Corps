// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import {
  emitSessionEvent,
  emitSignalingMessage,
  remoteControlChannel,
  remoteControlSessionChannel,
  subscribeSessionEvents,
  subscribeSignalingMessages,
  type SignalingEnvelope,
} from "@/lib/webrtc/remote-control-events";

/**
 * 远程控制事件总线契约（lib/webrtc/remote-control-events.ts）：
 *  - 按 userId 隔离通道：rc-signal:{userId} / rc-session:{userId}
 *  - emit → subscribe 送达信封（含 timestamp）；目标离线（无监听）时静默不抛
 *  - unsubscribe 幂等（RAII），会话事件同时送达发起方与目标方
 */
describe("通道命名", () => {
  it("信令通道 rc-signal:{userId}", () => {
    expect(remoteControlChannel("u1")).toBe("rc-signal:u1");
  });
  it("会话通道 rc-session:{userId}", () => {
    expect(remoteControlSessionChannel("u1")).toBe("rc-session:u1");
  });
});

describe("信令消息 emit/subscribe", () => {
  it("送达信封：message 原样 + timestamp 为数字", () => {
    const got: SignalingEnvelope[] = [];
    const off = subscribeSignalingMessages("u1", (e) => got.push(e));
    emitSignalingMessage("u1", { type: "offer", sdp: "s" });
    off();
    expect(got).toHaveLength(1);
    expect(got[0].message).toEqual({ type: "offer", sdp: "s" });
    expect(typeof got[0].timestamp).toBe("number");
  });

  it("通道隔离：发给 u2 的消息不会到 u1 的订阅者", () => {
    const got: unknown[] = [];
    const off = subscribeSignalingMessages("u1", (e) => got.push(e));
    emitSignalingMessage("u2", { type: "offer" });
    off();
    expect(got).toHaveLength(0);
  });

  it("目标离线（无监听器）：emit 静默，不抛", () => {
    expect(() => emitSignalingMessage("nobody", { type: "bye" })).not.toThrow();
  });

  it("unsubscribe 幂等：多次调用安全，且解绑后不再收", () => {
    const got: unknown[] = [];
    const off = subscribeSignalingMessages("u1", (e) => got.push(e));
    off();
    off(); // 幂等
    emitSignalingMessage("u1", { type: "after" });
    expect(got).toHaveLength(0);
  });

  it("多端订阅：同一用户两条订阅都收到（PC+手机）", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeSignalingMessages("u1", a);
    const offB = subscribeSignalingMessages("u1", b);
    emitSignalingMessage("u1", { type: "ice" });
    offA();
    offB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("会话状态事件 emit/subscribe", () => {
  it("同时送达发起方与目标方", () => {
    const initiator = vi.fn();
    const target = vi.fn();
    const off1 = subscribeSessionEvents("init", initiator);
    const off2 = subscribeSessionEvents("tgt", target);
    emitSessionEvent("init", "tgt", { type: "session-accepted", session: { id: "s1" } });
    off1();
    off2();
    expect(initiator).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledTimes(1);
    expect(initiator.mock.calls[0][0]).toEqual({
      type: "session-accepted",
      session: { id: "s1" },
    });
  });

  it("rejected/ended 可带 reason 透传", () => {
    const got: unknown[] = [];
    const off = subscribeSessionEvents("tgt", (e) => got.push(e));
    emitSessionEvent("init", "tgt", { type: "session-rejected", session: {}, reason: "busy" });
    off();
    expect(got).toEqual([{ type: "session-rejected", session: {}, reason: "busy" }]);
  });

  it("unsubscribe 幂等且解绑后不再收", () => {
    const fn = vi.fn();
    const off = subscribeSessionEvents("u1", fn);
    off();
    off();
    emitSessionEvent("u1", "u1", { type: "session-ended", session: {} });
    expect(fn).not.toHaveBeenCalled();
  });
});
