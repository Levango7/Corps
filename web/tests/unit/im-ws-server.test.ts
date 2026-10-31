// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * IM WebSocket 连接管理器契约（lib/im/ws-server.ts，单例 imManager）：
 *  - 单用户并发连接上限 5：第 6 条 → error + close(1008)（预认证与 auth 两条路径同判）
 *  - 认证闸门：无预认证时**只**放行 auth 消息，其余一律 error；令牌无效/过期 → error
 *  - 订阅三重防护：① 必须是会话成员 ② conversation.workspaceId 必须等于连接绑定的
 *    workspace（跨工作区隔离）③ 无绑定工作区同样拒绝
 *  - 广播：跳过非 OPEN socket、排除发送者本人（typing/read 不回显）；read 附 readByCount
 *  - 断开清理：三张映射表全清；该用户最后一条连接断开时广播 presence offline
 *  - onerror 兜底：30s 未收 onclose 强制清理
 *
 * 类未导出（只导出单例）→ 每个用例用唯一 userId/conversationId + 增量断言，避免串用共享态。
 */
const h = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  err: vi.fn(),
  warn: vi.fn(),
  /** 当前事务桩：由 setTx() 逐用例配置；withGuc 把收到的 fn 直接喂给它 */
  tx: {} as Record<string, unknown>,
}));

vi.mock("@/lib/jwt", () => ({ verifyAccessToken: h.verifyAccessToken }));
vi.mock("@/lib/auth", () => ({
  withGuc: vi.fn(async (_guc: unknown, fn: (tx: unknown) => unknown) => fn(h.tx)),
}));

import { imManager } from "@/lib/im/ws-server";

type Ws = {
  readyState: number;
  sent: string[];
  closed: { code?: number; reason?: string } | null;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: ((e: unknown) => void) | null;
};

function makeWs(): Ws {
  const ws: Ws = {
    readyState: 1,
    sent: [],
    closed: null,
    send(data: string) {
      ws.sent.push(data);
    },
    close(code?: number, reason?: string) {
      ws.closed = { code, reason };
    },
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return ws;
}

let seq = 0;
const uid = (tag: string) => `u-${tag}-${++seq}`;
const cid = (tag: string) => `c-${tag}-${++seq}`;

const sentOf = (ws: Ws) => ws.sent.map((s) => JSON.parse(s) as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyAccessToken.mockReset();
  setTx({});
  vi.spyOn(console, "error").mockImplementation(h.err);
  vi.spyOn(console, "warn").mockImplementation(h.warn);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── 工具：配置 withGuc 收到的 tx 行为 ──────────────────────────────
function setTx(opts: {
  workspaceId?: string | null;
  isMember?: boolean;
  readByCount?: number;
  hasEarliestMessage?: boolean;
}) {
  const { workspaceId = null, isMember = false, readByCount = 0, hasEarliestMessage = true } = opts;
  h.tx = {
    conversation: {
      findUnique: async () => (workspaceId ? { workspaceId } : null),
    },
    conversationMember: {
      findUnique: async () => (isMember ? { id: "m1", lastReadAt: null } : null),
      update: async () => ({}),
      count: async () => readByCount,
    },
    message: {
      findFirst: async () => (hasEarliestMessage ? { createdAt: new Date() } : null),
    },
  };
}

describe("连接上限与注册", () => {
  it("单用户第 6 条连接被拒：error + close(1008)", async () => {
    const userId = uid("cap");
    for (let i = 0; i < 5; i++) {
      const ws = makeWs();
      await imManager.handleConnection(ws as never, userId);
      expect(ws.closed).toBeNull();
    }
    const sixth = makeWs();
    await imManager.handleConnection(sixth as never, userId);
    expect(sixth.closed).toMatchObject({ code: 1008 });
    expect(sentOf(sixth)[0]).toMatchObject({
      type: "error",
      message: expect.stringContaining("连接数超限"),
    });
  });

  it("预认证注册计入在线数；断开后归零", async () => {
    const userId = uid("online");
    const before = imManager.getOnlineUserCount();
    const ws = makeWs();
    await imManager.handleConnection(ws as never, userId);
    expect(imManager.getOnlineUserCount()).toBe(before + 1);

    ws.onclose?.({ code: 1000, reason: "" });
    expect(imManager.getOnlineUserCount()).toBe(before);
  });

  it("未认证连接发非 auth 消息：一律 error（认证前不处理任何业务消息）", async () => {
    const ws = makeWs();
    await imManager.handleConnection(ws as never); // 无预认证
    ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: "x" }) });
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    expect(sentOf(ws)[0]).toMatchObject({
      type: "error",
      message: expect.stringContaining("未认证"),
    });
  });

  it("非法 JSON：error 且不断连", async () => {
    const ws = makeWs();
    await imManager.handleConnection(ws as never, uid("json"));
    ws.onmessage?.({ data: "{not json" });
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    expect(sentOf(ws)[0]).toMatchObject({
      type: "error",
      message: expect.stringContaining("JSON"),
    });
    expect(ws.closed).toBeNull();
  });

  it("heartbeat：静默（不回包）", async () => {
    const ws = makeWs();
    await imManager.handleConnection(ws as never, uid("hb"));
    ws.onmessage?.({ data: JSON.stringify({ type: "heartbeat" }) });
    await vi.waitFor(() => expect(ws.sent.length).toBe(0));
  });
});

describe("auth 消息路径", () => {
  it("无效令牌 → error（认证失败）；连接不注册", async () => {
    h.verifyAccessToken.mockResolvedValue(null);
    const before = imManager.getOnlineUserCount();
    const ws = makeWs();
    await imManager.handleConnection(ws as never);
    ws.onmessage?.({ data: JSON.stringify({ type: "auth", token: "bad" }) });
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    expect(sentOf(ws)[0].message).toContain("认证失败");
    expect(imManager.getOnlineUserCount()).toBe(before);
  });

  it("有效令牌 → 注册（在线上 +1；心跳可用了）", async () => {
    const userId = uid("auth");
    h.verifyAccessToken.mockResolvedValue({ sub: userId });
    const before = imManager.getOnlineUserCount();
    const ws = makeWs();
    await imManager.handleConnection(ws as never);
    ws.onmessage?.({ data: JSON.stringify({ type: "auth", token: "good" }) });
    await vi.waitFor(() => expect(imManager.getOnlineUserCount()).toBe(before + 1));
    expect(sentOf(ws)).toHaveLength(0); // 成功不发送回执
    // 之后业务消息不再被"未认证"挡
    ws.onmessage?.({ data: JSON.stringify({ type: "heartbeat" }) });
    await vi.waitFor(() => expect(ws.sent.length).toBe(0));
    ws.onclose?.({ code: 1000, reason: "" });
  });

  it("auth 也受连接数上限约束（第 6 条 auth → close 1008）", async () => {
    const userId = uid("authcap");
    h.verifyAccessToken.mockResolvedValue({ sub: userId });
    for (let i = 0; i < 5; i++) {
      const ws = makeWs();
      await imManager.handleConnection(ws as never, userId); // 预认证占满 5 条
      void ws;
    }
    const sixth = makeWs();
    await imManager.handleConnection(sixth as never);
    sixth.onmessage?.({ data: JSON.stringify({ type: "auth", token: "good" }) });
    await vi.waitFor(() => expect(sixth.closed).toMatchObject({ code: 1008 }));
  });
});

describe("subscribe：三重防护与订阅台账", () => {
  it("非成员：error（防跨会话窃听），不加入订阅", async () => {
    setTx({ workspaceId: "ws-1", isMember: false });
    const ws = makeWs();
    const userId = uid("sub");
    await imManager.handleConnection(ws as never, userId, "ws-1");
    const conversation = cid("sub");
    ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: conversation }) });
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    expect(sentOf(ws)[0].message).toContain("非该会话成员");
    expect(imManager.getConversationSubscriberCount(conversation)).toBe(0);
  });

  it("跨工作区：conversation.workspaceId ≠ 连接绑定 → 拒绝（即使成员资格通过）", async () => {
    setTx({ workspaceId: "ws-OTHER", isMember: true });
    const ws = makeWs();
    await imManager.handleConnection(ws as never, uid("xb"), "ws-1");
    const conversation = cid("xb");
    ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: conversation }) });
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    expect(sentOf(ws)[0].message).toContain("不属于当前工作区");
    expect(imManager.getConversationSubscriberCount(conversation)).toBe(0);
  });

  it("未绑定工作区（无 ?wid=）的连接：同样拒绝订阅", async () => {
    setTx({ workspaceId: "ws-1", isMember: true });
    const ws = makeWs();
    await imManager.handleConnection(ws as never, uid("nobind")); // 不传 boundWorkspaceId
    ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: "c-x" }) });
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    expect(sentOf(ws)[0].message).toContain("不属于当前工作区");
  });

  it("成功订阅：订阅计数 +1；unsubscribe 后归零", async () => {
    setTx({ workspaceId: "ws-1", isMember: true });
    const ws = makeWs();
    await imManager.handleConnection(ws as never, uid("ok"), "ws-1");
    const conversation = cid("ok");
    ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: conversation }) });
    await vi.waitFor(() => expect(imManager.getConversationSubscriberCount(conversation)).toBe(1));
    ws.onmessage?.({ data: JSON.stringify({ type: "unsubscribe", conversationId: conversation }) });
    await vi.waitFor(() => expect(imManager.getConversationSubscriberCount(conversation)).toBe(0));
    expect(ws.sent).toHaveLength(0); // 双向索引操作无回执
  });
});

describe("广播：typing / read / 在线状态", () => {
  it("typing：发给同会话其他订阅者，发送者本人不回显", async () => {
    setTx({ workspaceId: "ws-1", isMember: true });
    const conversation = cid("typing");
    const u1 = uid("t1");
    const u2 = uid("t2");
    const ws1 = makeWs();
    const ws2 = makeWs();
    await imManager.handleConnection(ws1 as never, u1, "ws-1");
    await imManager.handleConnection(ws2 as never, u2, "ws-1");
    for (const ws of [ws1, ws2]) {
      ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: conversation }) });
    }
    await vi.waitFor(() => expect(imManager.getConversationSubscriberCount(conversation)).toBe(2));

    ws1.onmessage?.({
      data: JSON.stringify({ type: "typing", conversationId: conversation, isTyping: true }),
    });
    await vi.waitFor(() => expect(ws2.sent.length).toBe(1));
    expect(sentOf(ws2)[0]).toMatchObject({ type: "typing", userId: u1, isTyping: true });
    expect(ws1.sent).toHaveLength(0); // 不回显
  });

  it("read：更新已读游标并广播回执（readByCount 来自成员计数）", async () => {
    const conversation = cid("read");
    setTx({ workspaceId: "ws-1", isMember: true, readByCount: 3 });
    const u1 = uid("r1");
    const u2 = uid("r2");
    const ws1 = makeWs();
    const ws2 = makeWs();
    await imManager.handleConnection(ws1 as never, u1, "ws-1");
    await imManager.handleConnection(ws2 as never, u2, "ws-1");
    for (const ws of [ws1, ws2]) {
      ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: conversation }) });
    }
    await vi.waitFor(() => expect(imManager.getConversationSubscriberCount(conversation)).toBe(2));

    ws1.onmessage?.({
      data: JSON.stringify({ type: "read", conversationId: conversation, messageIds: ["m-1"] }),
    });
    await vi.waitFor(() => expect(ws2.sent.length).toBe(1));
    expect(sentOf(ws2)[0]).toMatchObject({
      type: "read",
      userId: u1,
      messageIds: ["m-1"],
      readByCount: 3,
    });
    expect(ws1.sent).toHaveLength(0);
  });

  it("断开：清理订阅台账，且单连接用户断开时对端**收到** presence offline（会话集取断开前快照）", async () => {
    setTx({ workspaceId: "ws-1", isMember: true });
    const conversation = cid("pres");
    const u1 = uid("p1");
    const u2 = uid("p2");
    const before = imManager.getOnlineUserCount();
    const ws1 = makeWs();
    const ws2 = makeWs();
    await imManager.handleConnection(ws1 as never, u1, "ws-1");
    await imManager.handleConnection(ws2 as never, u2, "ws-1");
    for (const ws of [ws1, ws2]) {
      ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: conversation }) });
    }
    await vi.waitFor(() => expect(imManager.getConversationSubscriberCount(conversation)).toBe(2));

    ws1.onclose?.({ code: 1000, reason: "" });
    // 对端（u2 在同一会话）收到 u1 的 offline —— 会话集在清理前已快照
    await vi.waitFor(() => expect(ws2.sent.length).toBe(1));
    expect(sentOf(ws2)[0]).toMatchObject({ type: "presence", userId: u1, online: false });
    // 台账清理正确：u1 的订阅被清出、在线数回落
    expect(imManager.getConversationSubscriberCount(conversation)).toBe(1);
    expect(imManager.getOnlineUserCount()).toBe(before + 1); // 只剩 u2
  });

  it("广播跳过非 OPEN socket（send 不触达已关闭连接）", async () => {
    setTx({ workspaceId: "ws-1", isMember: true });
    const conversation = cid("closed");
    const u1 = uid("c1");
    const u2 = uid("c2");
    const ws1 = makeWs();
    const ws2 = makeWs();
    await imManager.handleConnection(ws1 as never, u1, "ws-1");
    await imManager.handleConnection(ws2 as never, u2, "ws-1");
    for (const ws of [ws1, ws2]) {
      ws.onmessage?.({ data: JSON.stringify({ type: "subscribe", conversationId: conversation }) });
    }
    await vi.waitFor(() => expect(imManager.getConversationSubscriberCount(conversation)).toBe(2));

    ws2.readyState = 3; // CLOSED 但还没触发 handleDisconnect
    ws1.onmessage?.({
      data: JSON.stringify({ type: "typing", conversationId: conversation, isTyping: true }),
    });
    await vi.waitFor(() => expect(ws1.sent.length).toBe(0));
    expect(ws2.sent).toHaveLength(0); // 未 OPEN → 不发送
  });
});

describe("onerror 兜底", () => {
  it("onerror 后 30s 未收 onclose：强制清理（在线数回落）", async () => {
    const userId = uid("err");
    const before = imManager.getOnlineUserCount();
    const ws = makeWs();
    await imManager.handleConnection(ws as never, userId);
    expect(imManager.getOnlineUserCount()).toBe(before + 1);

    ws.onerror?.({ type: "error" });
    vi.advanceTimersByTime(30_000);
    // 定时器回调在微任务后才可见——推一轮事件循环
    await Promise.resolve();
    expect(imManager.getOnlineUserCount()).toBe(before);
  });

  it("onerror 后正常收到 onclose：取消定时器（不重复清理）", async () => {
    const userId = uid("err2");
    const ws = makeWs();
    await imManager.handleConnection(ws as never, userId);
    ws.onerror?.({ type: "error" });
    ws.onclose?.({ code: 1000, reason: "" });
    vi.advanceTimersByTime(30_000); // 定时器已取消：不应再触发（无异常即可，且计数不回退到负）
    const before = imManager.getOnlineUserCount();
    await Promise.resolve();
    expect(imManager.getOnlineUserCount()).toBe(before);
  });
});
