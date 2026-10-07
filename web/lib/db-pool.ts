/**
 * 数据库连接池参数解析 + DATABASE_URL 归一化（DL-3 缺陷修复）。
 *
 * ─── 缺陷原委 ────────────────────────────────────────────────
 * lib/prisma.ts 原来只在文件头注释里写「通过 DATABASE_URL 的 query 参数配置
 * connection_limit / pool_timeout」，但全仓库 DATABASE_URL 的两处定义
 * （docker-compose.yml、web/.env.example）都只带 `?schema=public`——
 * 这两个参数**从未真正落地**。于是实际生效的一直是 Prisma 的默认值：
 *   - connection_limit 默认 = 容器可见 CPU 核数 × 2 + 1。它随宿主机漂移：
 *     核数多的机器/容器会膨胀到几十，多副本部署时每个副本各自开这么大，
 *     乘上副本数很容易顶爆 Postgres 的 max_connections。
 *   - pool_timeout 默认 10s。池饱和时请求先排队 10s 才失败，在 HTTP 请求
 *     链路里等于把一次 DB 抖动放大成 10s 的不可用，且期间无任何日志。
 * 注释描述了一个不存在的配置，比没有注释更危险：读代码的人会以为已经配好了。
 *
 * ─── 默认值取这两个数的理由 ──────────────────────────────────
 *  1. connectionLimit = 10：替代「CPU 核数 × 2 + 1」这个随宿主机漂移的值，
 *     固定为**可推理的常数**。容量规划要能算得清：副本数 × 10 就是上限，
 *     不需要先去查一遍宿主机有几个核。
 *  2. poolTimeoutSeconds = 5：等连接的最大秒数。池不饱和时等待时间接近 0，
 *     所以调小**不影响正常路径**；调小的唯一作用是池饱和时快速失败，
 *     让上层（withDbRetry / 503）立刻感知，而不是静默排队。
 *
 * ─── 覆盖优先级（显式优先）────────────────────────────────────
 *   URL query 里显式写的值 > CORPS_DB_CONNECTION_LIMIT / CORPS_DB_POOL_TIMEOUT_S
 *   > 本文件的默认值。
 * 运维在部署环境里显式写死的参数优先级最高：代码默认值只是**兜底**，
 * 不能在别人已经想清楚的地方悄悄改掉他的配置（见 withPoolParams 的缺失才补）。
 *
 * ─── 为什么本模块零依赖 ───────────────────────────────────────
 * 不 import @prisma/client。lib/prisma.ts 一旦被 import 就要求客户端生成产物
 * 存在、且 DATABASE_URL 已配置；而 CI 的 Unit Coverage Ratchet job 是全仓库
 * 唯一不设 DATABASE_URL 的 job。把解析逻辑放在这里，单元测试才能直接 import
 * 它而不需要 mock 掉整个 Prisma 模块（同时 lib/prisma.ts 保持 0 行覆盖，
 * 不触发 zero-coverage 基线的 STALE_COVERED 判红）。
 */

/** 连接池参数默认值（CPU 核数无关的固定常数，理由见文件头） */
export const DB_POOL_DEFAULTS = { connectionLimit: 10, poolTimeoutSeconds: 5 } as const;

/** connection_limit 上界：再大就该改架构（加副本/加 PgBouncer），而不是加连接 */
const CONNECTION_LIMIT_MAX = 100;
/** pool_timeout 上界（秒）：HTTP 链路下排队超过 1 分钟的请求已经没有意义 */
const POOL_TIMEOUT_MAX_S = 60;

/**
 * 读取一个正整数型环境变量。
 *
 * 判定顺序（越界与非法要区分处理）：
 *  - 未设置 / 空串 → 回退默认值（"没配"不是"配错"，不该报错）
 *  - 非有限数（NaN / Infinity）或非整数 → 回退默认值
 *  - ≤ 0 → 回退默认值：0 和负数在语义上都是"无效配置"，
 *    这里刻意不夹到下界 1——1 条连接的池在生产上等于自断一臂，
 *    把一个明显写错的值悄悄救成 1 比回退默认更难排查。
 *  - 超过上界 → 夹到上界（大方向是对的，只是给多了）
 *
 * 全程不抛错：连接池配置解析失败不应该让进程起不来，
 * 回退默认值 + 可观测日志（调用方在 lib/prisma.ts 打印）是更合适的失败模式。
 */
function readPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback; // NaN / Infinity
  if (!Number.isInteger(parsed)) return fallback; // 小数：秒数/条数都不接受小数
  if (parsed <= 0) return fallback; // 0 / 负数视为"没配"，回退默认而非夹到 1
  return Math.min(parsed, max);
}

/**
 * 从环境变量读取连接池配置。
 *
 * @param env - 环境变量源，默认 process.env；单元测试注入对象以隔离环境
 */
export function readPoolConfig(env: NodeJS.ProcessEnv = process.env): {
  connectionLimit: number;
  poolTimeoutSeconds: number;
} {
  return {
    connectionLimit: readPositiveInt(
      env.CORPS_DB_CONNECTION_LIMIT,
      DB_POOL_DEFAULTS.connectionLimit,
      CONNECTION_LIMIT_MAX,
    ),
    poolTimeoutSeconds: readPositiveInt(
      env.CORPS_DB_POOL_TIMEOUT_S,
      DB_POOL_DEFAULTS.poolTimeoutSeconds,
      POOL_TIMEOUT_MAX_S,
    ),
  };
}

/**
 * 向 DATABASE_URL 补齐连接池参数。
 *
 * **只补缺失的参数**：URL 里已经显式写了 connection_limit / pool_timeout 的，
 * 原样保留。这是"运维显式配置优先于代码默认值"的护栏——代码默认值是兜底，
 * 不是覆盖。
 *
 * 只重写 query 段、base 段（scheme://user:pass@host:port/path）原样透传，
 * 避免 URL 整体往返序列化把密码里的特殊字符重新编码一遍。
 *
 * @param url - 原始连接串（可带或不带 query）
 * @param cfg - 要补齐的参数，默认 DB_POOL_DEFAULTS
 */
export function withPoolParams(
  url: string,
  cfg: { connectionLimit: number; poolTimeoutSeconds: number } = DB_POOL_DEFAULTS,
): string {
  const qIndex = url.indexOf("?");
  const base = qIndex === -1 ? url : url.slice(0, qIndex);
  const query = qIndex === -1 ? "" : url.slice(qIndex + 1);

  const params = new URLSearchParams(query);
  if (!params.has("connection_limit")) {
    params.set("connection_limit", String(cfg.connectionLimit));
  }
  if (!params.has("pool_timeout")) {
    params.set("pool_timeout", String(cfg.poolTimeoutSeconds));
  }

  const next = params.toString();
  // query 为空时不能留下一个光秃秃的 "?"（'' 表示原始 URL 根本没有 query 段）
  return next === "" ? base : `${base}?${next}`;
}

/** DATABASE_URL 缺失/为空时抛出。带独立类型便于调用方区分"没配"与其他解析错误 */
export class DatabaseUrlMissingError extends Error {
  constructor() {
    super(
      "DATABASE_URL 未配置或为空，无法解析数据库连接串：" +
        "请检查部署环境变量；若当前上下文本就不需要访问数据库（如构建期/CI 单测），" +
        "调用方应捕获本错误并回退到 Prisma 默认行为。",
    );
    this.name = "DatabaseUrlMissingError";
  }
}

/**
 * 解析最终生效的 DATABASE_URL（原始 URL + 补齐的连接池参数）。
 *
 * 与直读 process.env.DATABASE_URL 的区别：这里**一定**带 connection_limit 与
 * pool_timeout，因此不再依赖随宿主机漂移的 Prisma 默认值。
 *
 * @throws {DatabaseUrlMissingError} DATABASE_URL 缺失或为空
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DATABASE_URL;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new DatabaseUrlMissingError();
  }
  return withPoolParams(raw.trim(), readPoolConfig(env));
}
