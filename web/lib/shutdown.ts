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

  // 刻意**不**在此注册 uncaughtException / unhandledRejection：
  // 本文件此前也注册了一份，且直接 process.exit(1)。两条后果都很实在——
  // ① 与 lib/observability.ts 声明的"rejection 仅上报、不改进程行为"互相矛盾，
  //    谁先注册都不影响结果，因为 shutdown 那份会立即退出；
  // ② 客户端中断请求冒出的 `Error: aborted` / ECONNRESET 会因此杀掉整个实例。
  // 进程级异常策略由 observability.installProcessErrorHandlers() 单一持有
  // （instrumentation.ts 先安装它）。
}
