/**
 * Next.js instrumentation hook — 在服务器启动时执行
 * 用于环境变量校验和优雅关闭注册
 */
import type { Instrumentation } from "next";

export async function register() {
  // 仅在服务端执行（非 Edge Runtime）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 进程级未处理异常捕获（最先安装：确保后续环境校验/启动阶段抛出的
    // unhandledRejection / uncaughtException 也能被上报，见 lib/observability.ts）
    const { installProcessErrorHandlers } = await import("./lib/observability");
    installProcessErrorHandlers();

    // 环境变量校验（fail-fast）
    const { getEnv } = await import("./lib/env");
    try {
      getEnv();
      console.info("[instrumentation] 环境变量校验通过");
    } catch (err) {
      console.error("[instrumentation] 环境变量校验失败:", err);
      // 生产环境直接退出，开发环境警告但继续
      if (process.env.NODE_ENV === "production") {
        process.exit(1);
      }
    }

    // 优雅关闭处理
    const { setupGracefulShutdown } = await import("./lib/shutdown");
    setupGracefulShutdown();
  }
}

/**
 * 请求级服务端错误上报（Next 内置钩子）。
 *
 * 为什么必须有：App Router 会**在框架内部捕获** route handler / SSR 渲染抛出的
 * 异常并返回 500——进程不会崩，`unhandledRejection`/`uncaughtException` 永不触发，
 * 因此这类**最高频的服务端错误**对现有一切上报（lib/observability.ts 的进程级
 * handler、global-error 前端边界）全部不可见，只能靠人翻 docker 日志。本钩子是
 * 它们进入 captureError 的唯一入口。
 *
 * 语义：
 * - 复用 captureError 全链（脱敏 / 限流 / Sentry Envelope / webhook 告警）；
 * - 传输层噪声（客户端断连）与进程级 handler 同判据过滤，不上报；
 * - 整个钩子包 try/catch——上报绝不影响错误响应本身。
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // RED 指标的 Errors 一维在这里接通（2026-10-25）。选这个钩子的理由：
  // 它在 Node runtime 跑，能拿到逐路由标识 context.routePath，且记录与上报
  // 解耦——上报走 Sentry/webhook，指标走 /api/metrics，两条链互不拖累。
  // Rate 与 Duration 两维没有诚实接入点（Edge runtime 的 middleware 状态不共享、
  // App Router 无全局完成钩子），见 web/lib/red-metrics.ts 顶部说明。
  try {
    const { captureError, isBenignTransportError } = await import("./lib/observability");
    const { recordError, normalizeRoute } = await import("./lib/red-metrics");
    if (isBenignTransportError(error)) return;
    recordError({ route: normalizeRoute(context.routePath), method: request.method });
    captureError(error, {
      source: "request",
      route: context.routePath,
      requestPath: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routeType: context.routeType,
    });
  } catch {
    // 上报失败不影响错误响应（与 captureError 的 fire-and-forget 语义一致）
  }
};
