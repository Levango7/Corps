// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 优雅关闭契约（lib/shutdown.ts）：
 *  - 只注册 SIGTERM/SIGINT；**刻意不注册 uncaughtException/unhandledRejection**
 *    （进程级异常策略由 observability.installProcessErrorHandlers 单一持有——
 *    重复注册且 exit(1) 会因客户端中断的 aborted/ECONNRESET 杀掉整个实例）
 *  - 收到信号：disconnect Prisma → clearTimeout → exit(0)；disconnect 抛错也照样退出
 *  - 幂等：第二次触发/重复 setup 不再执行
 *  - 超时兜底：10s 内没关完 → exit(1)
 */
const h = vi.hoisted(() => ({
  disconnect: vi.fn(),
  exit: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => void>(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $disconnect: h.disconnect },
}));

beforeEach(async () => {
  h.disconnect.mockReset();
  h.disconnect.mockResolvedValue(undefined);
  h.exit.mockReset();
  h.handlers.clear();
  vi.spyOn(process, "on").mockImplementation(((
    event: string | symbol,
    cb: (...a: unknown[]) => void,
  ) => {
    h.handlers.set(String(event), cb);
    return process;
  }) as never);
  vi.spyOn(process, "exit").mockImplementation(h.exit as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // 模块级 isShuttingDown 状态：resetModules 拿干净实例
  vi.resetModules();
  const mod = await import("@/lib/shutdown");
  mod.setupGracefulShutdown();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("注册面", () => {
  it("只注册 SIGTERM 与 SIGINT；不碰 uncaughtException / unhandledRejection", () => {
    const registered = [...h.handlers.keys()].sort();
    expect(registered).toEqual(["SIGINT", "SIGTERM"]);
  });

  it("重复 setup 不重复注册（幂等）", async () => {
    const mod = await import("@/lib/shutdown");
    mod.setupGracefulShutdown();
    const sigterm = h.handlers.get("SIGTERM");
    expect(sigterm).toBeTypeOf("function");
    // 只注册一次 → handlers map 仍只有两个键（重复 setup 直接 return）
    expect([...h.handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
  });
});

describe("关闭流程", () => {
  it("SIGTERM：disconnect → exit(0)", async () => {
    await h.handlers.get("SIGTERM")!();
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("SIGINT 同流程（PM2 reload 场景）", async () => {
    await h.handlers.get("SIGINT")!();
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("disconnect 抛错：吞掉错误并照常 exit(0)", async () => {
    h.disconnect.mockRejectedValue(new Error("db already gone"));
    await h.handlers.get("SIGTERM")!();
    expect(h.exit).toHaveBeenCalledWith(0);
  });

  it("幂等：第二次信号不再重复 disconnect", async () => {
    await h.handlers.get("SIGTERM")!();
    await h.handlers.get("SIGINT")!();
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it("超时兜底：10s 未完成 → exit(1)（fake timers）", async () => {
    vi.useFakeTimers();
    let resolveDisconnect!: () => void;
    h.disconnect.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveDisconnect = r;
        }),
    );
    const p = h.handlers.get("SIGTERM")!();
    vi.advanceTimersByTime(10_000);
    expect(h.exit).toHaveBeenCalledWith(1);
    // 收尾：完成挂起的 disconnect，避免悬挂
    resolveDisconnect();
    await p;
  });
});
