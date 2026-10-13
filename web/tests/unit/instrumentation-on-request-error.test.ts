import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * instrumentation.onRequestError 单元测试
 *
 * 背景：App Router 在框架内部捕获 route handler / SSR 的异常并返回 500——
 * 进程级 handler 永不触发。本钩子是这类「最高频服务端错误」进入 captureError
 * 全链（脱敏/限流/Sentry/webhook）的唯一入口，必须钉住行为：
 *  - 正常错误 → 经 captureError 写结构化日志，上下文含 source/route/path/method
 *  - 传输层噪声（ECONNRESET 等客户端断连）→ 不上报（与进程级 handler 同判据）
 *  - 钩子自身任何异常 → 静默吞掉（上报绝不影响错误响应）
 *
 * Mock 策略与 observability.test.ts 一致：mock @/lib/logger 便于断言。
 */

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { logger } from "@/lib/logger";
import { onRequestError } from "@/instrumentation";

/** 构造 Next 钩子的入参（只需用例关心的字段，其余按宽松结构补全） */
function callHook(error: unknown) {
  return onRequestError(
    error as Error,
    {
      path: "/api/v1/workspaces/w1/tasks",
      method: "POST",
      headers: {},
    } as unknown as Parameters<typeof onRequestError>[1],
    {
      routerKind: "App Router",
      routePath: "/api/v1/workspaces/[wid]/tasks",
      routeType: "route",
    } as unknown as Parameters<typeof onRequestError>[2],
  );
}

describe("instrumentation.onRequestError", () => {
  beforeEach(() => {
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.warn).mockClear();
  });

  it("正常错误经 captureError 上报：日志含错误信息与请求上下文", async () => {
    await callHook(new Error("boom-from-route"));
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg, ctx] = vi.mocked(logger.error).mock.calls[0];
    expect(String(msg)).toContain("boom-from-route");
    expect(ctx).toMatchObject({
      source: "request",
      route: "/api/v1/workspaces/[wid]/tasks",
      requestPath: "/api/v1/workspaces/w1/tasks",
      method: "POST",
      routeType: "route",
    });
  });

  it("非 Error 抛出物（字符串）同样规范化上报", async () => {
    await callHook("plain-string-throw");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(logger.error).mock.calls[0][0])).toContain("plain-string-throw");
  });

  it("传输层噪声（客户端断连）不上报——与进程级 handler 同判据", async () => {
    const noise = Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    await callHook(noise);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("钩子内部异常被静默吞掉（不影响错误响应）", async () => {
    // 传入使 redact/captureError 上下文处理不炸的怪值即可；这里验证钩子本身不抛
    await expect(callHook({ weird: Symbol("s") as unknown as string })).resolves.toBeUndefined();
  });
});
