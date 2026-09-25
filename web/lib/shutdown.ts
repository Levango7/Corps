/* eslint-disable no-console -- 优雅关闭需在 logger 初始化前输出 */

import { prisma } from "@/lib/prisma";

/**
 * 优雅关闭处理 — 监听 SIGTERM/SIGINT 信号，清理资源后退出
 *
 * 使用场景：
 * - Docker stop/compose down 发送 SIGTERM
 * - K8s pod termination 发送 SIGTERM（30s grace period）
 * - PM2 reload 发送 SIGINT
 *
 * 清理步骤：
 * 1. 停止接受新请求（Next.js server 自动处理）
 * 2. 等待进行中的请求完成（最多 10s）
 * 3. 关闭 Prisma 连接池
 * 4. 退出进程
 */

const SHUTDOWN_TIMEOUT_MS = 10_000;
let isShuttingDown = false;

export function setupGracefulShutdown(): void {
  // 防止重复注册
  if (isShuttingDown) return;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`[shutdown] 收到 ${signal}，开始优雅关闭...`);

    // 设置超时强制退出
    const forceExit = setTimeout(() => {
      console.error("[shutdown] 超时，强制退出");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      // 关闭 Prisma 连接池
      console.log("[shutdown] 关闭数据库连接...");
      await prisma.$disconnect();
      console.log("[shutdown] 数据库连接已关闭");
    } catch (err) {
      console.error("[shutdown] 关闭数据库连接失败:", err);
    }

    clearTimeout(forceExit);
    console.log("[shutdown] 优雅关闭完成，退出进程");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // 未捕获异常 — 记录后退出
  process.on("uncaughtException", (err) => {
    console.error("[shutdown] uncaughtException:", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[shutdown] unhandledRejection:", reason);
    process.exit(1);
  });
}
