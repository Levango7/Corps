// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import {
  emitWorkspaceEvent,
  subscribeWorkspaceEvents,
  workspaceChannel,
  workspaceEvents,
  type WorkspaceEvent,
} from "@/lib/workspace-events";

/**
 * 工作区事件总线契约（lib/workspace-events.ts）：
 *  - 按工作区隔离：workspace:{workspaceId} 通道；跨工作区事件不串线
 *  - emit → subscribe 送达原样事件对象；无人订阅时静默
 *  - unsubscribe 幂等（RAII）；多端订阅（看板+详情+仪表盘）各自收到
 *  - 监听器上限 100（防泄漏），并复用 chat-events 的 SSE 额度（acquireSseSlot 再导出）
 *
 * 注：生产环境多实例警告块在 import 时按 env 执行——本文件不断言该分支（属 env 组合的
 * 日志行为），如需覆盖请用 resetModules + stubEnv 动态 import。
 */
describe("通道命名与导出面", () => {
  it("workspaceChannel = workspace:{workspaceId}", () => {
    expect(workspaceChannel("w1")).toBe("workspace:w1");
  });

  it("单用户并发 SSE 额度管理经本模块再导出（与 chat 通道共享）", async () => {
    const mod = await import("@/lib/workspace-events");
    expect(typeof mod.acquireSseSlot).toBe("function");
    expect(typeof mod.releaseSseSlot).toBe("function");
    expect(typeof mod.tryAcquireSseSlot).toBe("function");
  });

  it("监听器上限设为 100（多端订阅防泄漏）", () => {
    expect(workspaceEvents.getMaxListeners()).toBe(100);
  });
});

describe("emit / subscribe", () => {
  it("事件原样送达订阅者；跨工作区隔离", () => {
    const got: WorkspaceEvent[] = [];
    const other: WorkspaceEvent[] = [];
    const off1 = subscribeWorkspaceEvents("w1", (e) => got.push(e));
    const off2 = subscribeWorkspaceEvents("w2", (e) => other.push(e));

    const ev: WorkspaceEvent = { type: "task.created", taskId: "t1", title: "T", status: "todo" };
    emitWorkspaceEvent("w1", ev);

    off1();
    off2();
    expect(got).toEqual([ev]);
    expect(other).toEqual([]);
  });

  it("无人订阅：emit 静默不抛（首次连接前的事件丢弃，前端补拉）", () => {
    expect(() => emitWorkspaceEvent("nobody", { type: "ping" })).not.toThrow();
  });

  it("多端订阅：同一工作区两条订阅都收到", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeWorkspaceEvents("w1", a);
    const offB = subscribeWorkspaceEvents("w1", b);
    emitWorkspaceEvent("w1", { type: "presence.online", userId: "u1" });
    offA();
    offB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe 幂等：多次调用安全，解绑后不再收", () => {
    const fn = vi.fn();
    const off = subscribeWorkspaceEvents("w1", fn);
    off();
    off();
    emitWorkspaceEvent("w1", { type: "ping" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("事件联合的各分支类型都能原样透传（task.* / presence.* / ping）", () => {
    const got: WorkspaceEvent[] = [];
    const off = subscribeWorkspaceEvents("w1", (e) => got.push(e));
    const events: WorkspaceEvent[] = [
      { type: "task.updated", taskId: "t", title: "x", status: "done" },
      { type: "task.deleted", taskId: "t", title: "x" },
      { type: "presence.offline", userId: "u" },
      { type: "ping" },
    ];
    for (const e of events) emitWorkspaceEvent("w1", e);
    off();
    expect(got).toEqual(events);
  });
});
