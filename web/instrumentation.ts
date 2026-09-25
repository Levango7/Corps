/**
 * Next.js instrumentation hook — 在服务器启动时执行
 * 用于环境变量校验和优雅关闭注册
 */
export async function register() {
  // 仅在服务端执行（非 Edge Runtime）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 环境变量校验（fail-fast）
    const { getEnv } = await import("./lib/env");
    try {
      getEnv();
      console.log("[instrumentation] 环境变量校验通过");
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
