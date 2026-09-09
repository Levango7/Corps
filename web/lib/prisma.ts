import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Prisma Client 单例。
 *
 * 连接池配置（DL-3）：
 *  Prisma 的连接池通过 DATABASE_URL 的 query 参数配置，例如：
 *  postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=30
 *  - connection_limit：连接池大小（默认 = CPU 核数 × 2 + 1）
 *  - pool_timeout：获取连接超时秒数（默认 10）
 *  - schema：数据库 schema 名（默认 public）
 *  生产环境建议 connection_limit=10-20，pool_timeout=30。
 *
 * ─── 缓存层规划（DL-5，P3 降级：文档说明）────────────────────────────
 * 当前状态：**无业务数据缓存层**——所有读请求直达 PostgreSQL，热点查询
 * （如看板任务列表、通知未读计数、工作区成员清单）每次都走 DB。
 *
 * 规划方向（后续迭代引入，不在本次 P3 范围内实现）：
 *  1. **Redis 缓存**（首选）：引入 ioredis / @upstash/redis，对以下场景做缓存：
 *     - 看板视图（Task 列表按 workspace+status 分组）：TTL 60s，写操作（创建/
 *       更新/删除任务）按 workspaceId 失效。
 *     - 通知未读计数（Notification where read=false count）：TTL 30s，写操作
 *       按 userId+workspaceId 失效。
 *     - 工作区成员清单（Member 列表）：TTL 120s，成员变更时按 workspaceId 失效。
 *  2. **缓存键命名**：`{domain}:{tenant}:{entity}:{id}`，如 `tasks:ws:{workspaceId}:board`。
 *  3. **失效策略**：写后失效（Cache-Aside），不做写穿透；避免缓存与 DB 不一致。
 *  4. **降级策略**：Redis 不可用时回退到直查 DB（与 withDbRetry 同模式）。
 *  5. **Serverless 注意**：Vercel/Edge 函数中 Redis 连接需用 Upstash REST 或
 *     全局单例 + keepAlive，避免冷启动连接风暴。
 *
 * 当前不引入的原因：P3 优先级，且现有查询均已建立合适索引（见 schema.prisma
 * 各 model 的 @@index），DB 命中率与延迟在当前量级可接受。引入缓存会带来
 * 一致性复杂度（写后失效漏判）与运维成本（Redis 实例监控），需在 P2 优化
 * 周期统一评估。
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * DB 连接失败重试包装器（DL-4）。
 *
 * 在 Prisma P1001（Can't reach database server）等连接错误时自动重试，
 * 适用于 Serverless / 云函数环境中 DB 冷启动导致的瞬断。
 *
 * 用法：将原本直接调用 prisma 的操作包裹为 withDbRetry(() => prisma.user.findMany(...))
 * 或在事务中：withDbRetry(() => prisma.$transaction(async (tx) => { ... }))
 *
 * 注意：仅在连接级错误重试，业务错误（如 P2002 唯一约束冲突）不重试。
 */
const DB_RETRY_MAX = 3;
const DB_RETRY_DELAY_MS = 500;

export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= DB_RETRY_MAX; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // 仅在连接级错误重试（P1001: Can't reach database server, P1002: Database kind wrong）
      const isConnectionError =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P1001" || error.code === "P1002");
      if (!isConnectionError || attempt === DB_RETRY_MAX) {
        throw error;
      }
      // 指数退避：500ms, 1000ms, 2000ms
      await new Promise((resolve) => setTimeout(resolve, DB_RETRY_DELAY_MS * 2 ** attempt));
    }
  }
  throw lastError;
}
