// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 远程控制信令客户端契约（lib/webrtc/signaling.ts）：
 *  - connect：SSE URL 带编码后的 workspaceId + withCredentials；connecting→connected；
 *    **幂等**（connected/connecting 期间重入不建第二条连接）
 *  - onmessage：JSON 信封 → 只投递 envelope.message；坏 JSON 不抛（记 error）；
 *    **单个 listener 抛错不影响其他 listener**（逐个 try-catch）
 *  - onerror / 连接超时：主动 close + 自管**指数退避重连**（1s→2s→…→max 封顶）
 *  - send：走统一 api() 客户端 POST（不依赖 SSE 是否在线）；disposed 后抛
 *  - disconnect：幂等；清定时器/关连接/清订阅；之后 connect 不再建连
 *  - SSR：无 window 时 connect 直接返回（不创建 EventSource）
 */
interface FakeES {
  url: string;
  withCredentials: boolean;
  onopen: (() => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  closed: boolean;
  close: () => void;
}

const h = vi.hoisted(() => ({
  api: vi.fn(),
  err: vi.fn(),
  esInstances: [] as unknown[],
}));

vi.mock("@/lib/api", () => ({ api: h.api }));

class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly url: string;
  readonly withCredentials: boolean;
  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    h.esInstances.push(this); // 实例自身进记录（回调赋值即见）
  }
  close() {
    this.closed = true;
  }
}

import { SignalingClient, createSignalingClient } from "@/lib/webrtc/signaling";

const inst = (i: number): FakeES => h.esInstances[i] as FakeES;
const triggerOpen = (i = h.esInstances.length - 1) => inst(i).onopen?.();
const triggerError = (i = h.esInstances.length - 1) => inst(i).onerror?.();
const triggerMessage = (data: unknown, i = h.esInstances.length - 1) => {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  inst(i).onmessage?.({ data: payload } as MessageEvent);
};

beforeEach(() => {
  h.api.mockReset();
  h.api.mockResolvedValue({});
  h.err.mockReset();
  h.esInstances.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  vi.spyOn(console, "error").mockImplementation(h.err);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connect：SSE 建立与幂等", () => {
  it("URL 带编码 workspaceId + withCredentials；open 后状态 connected", async () => {
    const client = new SignalingClient({ workspaceId: "ws 1/x" });
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));
    await client.connect();
    expect(h.esInstances).toHaveLength(1);
    expect(inst(0).url).toBe(
      `/api/v1/remote-control/signal?workspaceId=${encodeURIComponent("ws 1/x")}`,
    );
    expect(inst(0).withCredentials).toBe(true);
    expect(client.state).toBe("connecting");
    triggerOpen();
    expect(client.state).toBe("connected");
    expect(states).toEqual(["connecting", "connected"]);
  });

  it("connected/connecting 期间重入 connect：不建第二条连接", async () => {
    const client = new SignalingClient({ workspaceId: "w" });
    await client.connect();
    await client.connect();
    triggerOpen();
    await client.connect();
    expect(h.esInstances).toHaveLength(1);
  });

  it("SSR（无 window）：connect 直接返回，不创建 EventSource", async () => {
    vi.stubGlobal("window", undefined);
    const client = new SignalingClient({ workspaceId: "w" });
    await expect(client.connect()).resolves.toBeUndefined();
    expect(h.esInstances).toHaveLength(0);
  });
});

describe("onmessage：信封解析与投递", () => {
  it("只投递 envelope.message；坏 JSON 与空信封不投递、不抛", async () => {
    const client = new SignalingClient({ workspaceId: "w" });
    const got: unknown[] = [];
    client.onMessage((m) => got.push(m));
    await client.connect();

    triggerMessage({ message: { type: "offer", sdp: "s" }, timestamp: 1 });
    expect(got).toEqual([{ type: "offer", sdp: "s" }]);

    triggerMessage("{not json");
    triggerMessage({ timestamp: 2 }); // 无 message
    expect(got).toHaveLength(1);
    expect(h.err).toHaveBeenCalledWith(
      "[signaling] failed to parse SSE message:",
      expect.any(Error),
    );
  });

  it("单个 listener 抛错不影响其他 listener（逐个 try-catch）", async () => {
    const client = new SignalingClient({ workspaceId: "w" });
    const bad = vi.fn(() => {
      throw new Error("listener boom");
    });
    const good = vi.fn();
    client.onMessage(bad);
    client.onMessage(good);
    await client.connect();
    triggerMessage({ message: { type: "ping" }, timestamp: 1 });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    expect(h.err).toHaveBeenCalledWith("[signaling] listener error:", expect.any(Error));
  });

  it("onMessage 退订幂等：退订后不再收", async () => {
    const client = new SignalingClient({ workspaceId: "w" });
    const fn = vi.fn();
    const off = client.onMessage(fn);
    await client.connect();
    off();
    off();
    triggerMessage({ message: { type: "ping" }, timestamp: 1 });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("重连：指数退避与超时守卫", () => {
  it("onerror：关旧连接 → 1s 后重连 → 2s 后再失败（指数退避）", async () => {
    const client = new SignalingClient({ workspaceId: "w", maxReconnectIntervalMs: 10_000 });
    await client.connect();
    triggerOpen();
    triggerError();
    expect(inst(0).closed).toBe(true);
    expect(client.state).toBe("error");

    vi.advanceTimersByTime(1000);
    expect(h.esInstances).toHaveLength(2);
    triggerError(1);
    vi.advanceTimersByTime(1999);
    expect(h.esInstances).toHaveLength(2); // 未到 2s
    vi.advanceTimersByTime(1);
    expect(h.esInstances).toHaveLength(3); // 第二次重连（2s）
  });

  it("退避封顶：min(2^n·1s, max)（max=1500 → 第二次按 1500）", async () => {
    const client = new SignalingClient({ workspaceId: "w", maxReconnectIntervalMs: 1500 });
    await client.connect();
    triggerError();
    vi.advanceTimersByTime(1000);
    expect(h.esInstances).toHaveLength(2);
    triggerError(1);
    vi.advanceTimersByTime(1500);
    expect(h.esInstances).toHaveLength(3);
  });

  it("连接超时（connectTimeoutMs 内无 open）：关闭并进入重连", async () => {
    const client = new SignalingClient({ workspaceId: "w", connectTimeoutMs: 3000 });
    await client.connect();
    expect(h.esInstances).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(inst(0).closed).toBe(true);
    expect(client.state).toBe("error");
    vi.advanceTimersByTime(1000);
    expect(h.esInstances).toHaveLength(2);
  });

  it("open 成功会清掉超时守卫（之后时间推进不误杀连接）", async () => {
    const client = new SignalingClient({ workspaceId: "w", connectTimeoutMs: 3000 });
    await client.connect();
    triggerOpen(); // 3000ms 前收到 open
    vi.advanceTimersByTime(10_000);
    expect(inst(0).closed).toBe(false);
    expect(client.state).toBe("connected");
    expect(h.esInstances).toHaveLength(1);
  });
});

describe("send：POST 信令 + disposed 守卫", () => {
  it("走统一 api()：POST + JSON body（不要求 SSE 在线）", async () => {
    const client = new SignalingClient({ workspaceId: "w" });
    const msg = { type: "offer", sdp: "s", fromUserId: "a", toUserId: "b", sessionId: "s1" };
    await client.send(msg as never);
    expect(h.api).toHaveBeenCalledWith("/api/v1/remote-control/signal", {
      method: "POST",
      body: JSON.stringify(msg),
    });
  });

  it("disconnect 之后 send：抛（client disposed）", async () => {
    const client = new SignalingClient({ workspaceId: "w" });
    client.disconnect();
    await expect(client.send({ type: "ping" } as never)).rejects.toThrow(/disposed/);
    expect(h.api).not.toHaveBeenCalled();
  });
});

describe("disconnect：幂等清理", () => {
  it("关连接、清退避定时器、清订阅、状态 disconnected；之后不再建连", async () => {
    const client = new SignalingClient({ workspaceId: "w" });
    const onMsg = vi.fn();
    client.onMessage(onMsg);
    await client.connect();
    triggerOpen();
    triggerError(); // 排入重连定时器
    expect(client.state).toBe("error");

    client.disconnect();
    client.disconnect(); // 幂等
    expect(client.state).toBe("disconnected");

    vi.advanceTimersByTime(60_000); // 定时器已清：不再重连
    expect(h.esInstances).toHaveLength(1);

    await client.connect(); // disposed 后 connect 为 no-op
    expect(h.esInstances).toHaveLength(1);
    triggerMessage({ message: { type: "ping" }, timestamp: 1 }, 0);
    expect(onMsg).not.toHaveBeenCalled();
  });
});

describe("工厂", () => {
  it("createSignalingClient 返回可用的 SignalingClient", async () => {
    const client = createSignalingClient({ workspaceId: "w" });
    expect(client).toBeInstanceOf(SignalingClient);
    expect(client.state).toBe("disconnected");
    await client.connect();
    triggerOpen();
    expect(client.state).toBe("connected");
  });
});
