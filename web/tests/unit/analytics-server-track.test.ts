// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 服务端埋点契约（lib/analytics-server.ts）：
 *  - 终态签名（P2-2 裁决二）：{ userId?, workspaceId, sessionId?, name, props? }
 *    ——支付线 webhook 四埋点只消费此签名，形变即破坏支付线
 *  - 落库适配：userId ?? null 入库、sessionId 缺省 null、props 缺省 {}、id 为随机 UUID
 *  - 走 runWithAuthOp("provision") 逃生口（analytics_events 在 RLS 下直写会被静默拒）
 *  - 失败不抛（不阻塞主流程），但必须 console.error 记日志（M13：不得静默吞）
 */
const h = vi.hoisted(() => ({
  create: vi.fn(),
  err: vi.fn(),
  uuid: "11111111-2222-3333-4444-555555555555",
}));

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(async (_op: string, fn: (tx: unknown) => unknown, _uid?: string) =>
    fn({ analyticsEvent: { create: h.create } }),
  ),
}));

vi.mock("crypto", async (importOriginal) => {
  const orig = await importOriginal<typeof import("crypto")>();
  return { ...orig, randomUUID: () => h.uuid };
});

import { trackServerEvent } from "@/lib/analytics-server";

beforeEach(() => {
  h.create.mockReset();
  h.err.mockReset();
  vi.spyOn(console, "error").mockImplementation(h.err);
});

describe("trackServerEvent", () => {
  it("完整字段：UUID id + userId/workspaceId/sessionId/props 落库；走 provision 逃生口", async () => {
    h.create.mockResolvedValue({ id: h.uuid });
    await trackServerEvent({
      userId: "u1",
      workspaceId: "w1",
      sessionId: "s1",
      name: "checkout_started",
      props: { plan: "pro" },
    });
    expect(h.create).toHaveBeenCalledWith({
      data: {
        id: h.uuid,
        userId: "u1",
        workspaceId: "w1",
        name: "checkout_started",
        props: { plan: "pro" },
        sessionId: "s1",
      },
    });
    const { runWithAuthOp } = await import("@/lib/auth");
    expect(runWithAuthOp).toHaveBeenCalledWith(
      "provision",
      expect.any(Function),
      "u1", // 第三参透传 userId（auth.ts 签名要求 string | undefined）
    );
  });

  it("可选字段缺省：userId→null、sessionId→null、props→{}；userId=null 时第三参传 undefined", async () => {
    h.create.mockResolvedValue({});
    await trackServerEvent({ userId: null, workspaceId: null, name: "anon_event" });
    expect(h.create).toHaveBeenCalledWith({
      data: {
        id: h.uuid,
        userId: null,
        workspaceId: null,
        name: "anon_event",
        props: {},
        sessionId: null,
      },
    });
    const { runWithAuthOp } = await import("@/lib/auth");
    expect(runWithAuthOp).toHaveBeenLastCalledWith("provision", expect.any(Function), undefined);
  });

  it("落库失败：不抛（返回已消化 Promise），但记录 console.error（含事件名与工作区）", async () => {
    h.create.mockRejectedValue(new Error("rls denied"));
    await expect(
      trackServerEvent({ workspaceId: "w9", name: "payment_succeeded" }),
    ).resolves.toBeUndefined();
    expect(h.err).toHaveBeenCalledWith(
      expect.stringContaining("[analytics-server] trackServerEvent 失败"),
      expect.stringContaining("rls denied"),
    );
    expect(h.err.mock.calls[0][0]).toContain("name=payment_succeeded");
    expect(h.err.mock.calls[0][0]).toContain("wid=w9");
  });

  it("成功路径不产生 error 日志", async () => {
    h.create.mockResolvedValue({});
    await trackServerEvent({ workspaceId: "w1", name: "ok_event" });
    expect(h.err).not.toHaveBeenCalled();
  });
});
