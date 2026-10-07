import { PrismaClient, type Prisma } from "@prisma/client";
import { resolveDatabaseUrl } from "./db-pool";
import { runWithDbRetry } from "./db-retry";

/**
 * Prisma Client 单例。
 *
 * 连接池配置（DL-3，2026-10-07 修正）：
 *  连接串在**构造时**经 resolveDatabaseUrl()（lib/db-pool.ts）补齐
 *  connection_limit 与 pool_timeout 后显式传入，不再依赖 Prisma 默认值。
 *   - connection_limit：连接池大小。默认 10（代码常量，不随宿主机 CPU 核数漂移）。
 *   - pool_timeout：获取连接的最长等待秒数。默认 10（池不饱和时等待接近 0，
 *     所以它只影响池饱和场景：继续排队还是快速失败）。
 *     **与 lib/auth.ts:252 的 maxWait=10_000 强耦合**：事务内取连接的有效
 *     等待 = min(pool_timeout, maxWait)，取小者生效。初版写 5，等于把那段按
 *     __prisma_pool_conc.cjs 实测（并发 8 事务需 2.4s 拿全连接）才从 2s 放宽
 *     到 10s 的余量悄悄砍回一半，故修正为 10。
 *   - schema：数据库 schema 名（默认 public）
 *  覆盖方式（优先级从高到低）：
 *   1. DATABASE_URL 的 query 里显式写死——运维显式配置优先，代码不覆盖
 *   2. 环境变量 CORPS_DB_CONNECTION_LIMIT / CORPS_DB_POOL_TIMEOUT_S
 *   3. lib/db-pool.ts 的 DB_POOL_DEFAULTS
 *  修正前本段注释描述的是**一个并不存在的配置**：全仓库 DATABASE_URL 的两处
 *  定义都只有 ?schema=public，于是实际生效的一直是 Prisma 默认值
 *  （connection_limit = 容器可见 CPU 核数 × 2 + 1，随宿主机漂移；多副本时容易
 *  顶爆 Postgres 的 max_connections）。因果链见 lib/db-pool.ts 文件头。
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

/**
 * 构造时解析最终连接串（补上 connection_limit / pool_timeout，见文件头注释）。
 *
 * try/catch **不是可选的**：CI 的 Unit Coverage Ratchet job 是全仓库唯一不设
 * DATABASE_URL 的 job，next build / 静态分析同样可能在没有 DATABASE_URL 的
 * 上下文里加载本模块。缺了它就会在"本不该炸的地方"炸——模块加载期抛错，
 * 而不是等到真正访问数据库时才报错。因此解析失败时回退到 Prisma 默认行为
 * （由 Prisma 自行读 schema.prisma 的 env 配置），只打一条结构化提示。
 * 运行时真正要访问数据库的路径上 DATABASE_URL 一定是配好的。
 */
const resolvedUrl = (() => {
  try {
    return resolveDatabaseUrl();
  } catch (error) {
    console.error(
      "[db-pool] DATABASE_URL 未配置或为空，回退到 Prisma 默认连接配置（不注入连接池参数）：",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
})();

/** 日志级别：dev 下开 query 便于本地排查慢查询，生产只留 error/warn 之外的错误 */
const clientLog: Array<"query" | "error" | "warn"> =
  process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"];

/**
 * 构造参数。
 *
 * 显式类型标注**不是可选的**：生成的 PrismaClient 构造函数是
 * `constructor(optionsArg?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>)`，
 * ClientOptions 由实参反推。把三元表达式直接放在实参位置时，TS 只从两个分支的
 * 公共属性推出 `{ log }`，随后把 datasources 判成"多余属性"——实测报错：
 *   lib/prisma.ts(81,11): error TS2345 ... 'datasources' does not exist in type
 *   'Subset<{ log: ("query"|"warn"|"error")[] }, PrismaClientOptions>'
 * 标注后 ClientOptions 固定为完整的 PrismaClientOptions，两个分支都能通过。
 */
const clientOptions: Prisma.PrismaClientOptions = resolvedUrl
  ? { datasources: { db: { url: resolvedUrl } }, log: clientLog }
  : { log: clientLog };

export const prisma = globalForPrisma.prisma ?? new PrismaClient(clientOptions);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * DB 连接失败重试包装器（DL-4，2026-10-07 加固：新增总预算兜底）。
 *
 * 在 Prisma P1001（Can't reach database server）等连接错误时自动重试，
 * 适用于 Serverless / 云函数环境中 DB 冷启动导致的瞬断。
 *
 * 用法：将原本直接调用 prisma 的操作包裹为 withDbRetry(() => prisma.user.findMany(...))
 * 或在事务中：withDbRetry(() => prisma.$transaction(async (tx) => { ... }))
 *
 * 注意：仅在连接级错误重试，业务错误（如 P2002 唯一约束冲突）不重试。
 *
 * ─── 加固点（逻辑已下沉到 lib/db-retry.ts，本函数只保留导出签名）──────
 *  1. **总预算兜底**：一次调用的全部尝试 + 退避共享一个 deadline
 *     （默认 30s = lib/auth.ts:252 的 maxWait 10s + 事务 timeout 20s，
 *     即恰好覆盖一次最坏情况的尝试；可用 CORPS_DB_OP_BUDGET_MS 覆盖），
 *     最坏延迟因此有上界。原实现最坏是 4 次尝试 × pool_timeout + 退避，
 *     没有上界。
 *  2. **超时是终态**：预算耗尽抛 DbOperationTimeoutError 且**不再重试**——
 *     预算已花光，再排队只会把刚缓解的连接池重新打满。
 *  3. 存在理由：原实现的重试判据依赖 Prisma 肯抛 P1008（Operations timed out，
 *     **不是**"取连接超时"——取连接超时是 P2024，佐证见 lib/prisma-error.ts:
 *     72-75）。ADR-014 的 Prisma 7 升级会改变连接池语义，P1008 可能不再出现。
 *     届时旧实现不会报错、不会告警，请求只是无限排队（日志全绿、监控无感）。
 *     总预算兜底不依赖任何 Prisma 错误码，把这个"判据失效 → 静默挂起"的
 *     失效模式堵住。
 *  4. 池饱和（P2024）**deliberate 不重试**：那时重试会把拥塞放大成惊群，
 *     正确行为是快速失败返回 503 交给上层/用户。详见 lib/db-retry.ts 中
 *     RETRYABLE_DB_CODES 旁的决策注释。
 */
export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  return runWithDbRetry(fn);
}
