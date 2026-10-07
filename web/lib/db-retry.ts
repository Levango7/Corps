/**
 * DB 操作重试 + 总预算兜底（DL-4 缺陷修复）。
 *
 * ─── 缺陷原委 ────────────────────────────────────────────────
 * 原实现（lib/prisma.ts 的 withDbRetry）只对 P1001 / P1002 / P1008 重试，
 * 且**没有任何请求级超时兜底**。这里有两个叠加的风险：
 *
 *  1. 重试判据依赖 Prisma 肯抛 P1008。ADR-014 的 Prisma 7 升级计划会改变
 *     连接池语义，P1008（Operations timed out / 取连接超时）可能不再出现。
 *     一旦它不出现，withDbRetry 不会报错、不会告警——请求只是无限排队，
 *     日志全绿、监控无感。这是最难发现的一类事故模式：**判据失效后系统
 *     退化成静默挂起，而不是报错**。
 *  2. 即使判据正常，最坏延迟也没有上界：4 次尝试 × pool_timeout + 指数退避，
 *     在 Serverless 里会一路顶到平台超时才被杀掉。
 *
 * ─── 本模块的取舍 ────────────────────────────────────────────
 *  - **总预算（deadline）语义**，不是每次尝试各自计时：budgetMs 覆盖
 *    全部尝试 + 退避等待的总和，所以最坏延迟有明确上界。
 *  - **超时是终态**：预算耗尽即抛 DbOperationTimeoutError，且**不再重试**。
 *    预算已经花光，再排队只会让情况更糟（重试风暴会把刚缓解的池再打满）。
 *  - 可重试错误之外的一切（P2002 等业务错误）立即抛出，不重试。
 *
 * ─── 为什么本模块零依赖 ───────────────────────────────────────
 * 不 import @prisma/client：同 lib/db-pool.ts，CI 的 Unit Coverage Ratchet
 * job 不设 DATABASE_URL，且本地未必有客户端生成产物。判据改为鸭子类型
 * （见 isRetryableDbError 注释里的等价性与代价说明）。
 */

/** 可重试的连接级错误码 */
export const RETRYABLE_DB_CODES = ["P1001", "P1002", "P1008"] as const;

/** 最大重试次数（不含首次尝试：最坏共 1 + 3 = 4 次尝试） */
export const DB_RETRY_MAX = 3;
/** 指数退避基数（毫秒）：500 → 1000 → 2000 */
export const DB_RETRY_DELAY_MS = 500;
/** 单次 DB 操作的总预算默认值（毫秒）：覆盖全部尝试与退避的总和 */
export const DB_OP_BUDGET_MS_DEFAULT = 15_000;

/** 退避抖动比例上限：0–30%，用于打散多实例同步重试（R8D-08） */
const JITTER_RATIO = 0.3;

/**
 * 总预算耗尽时抛出。
 *
 * 携带两个字段便于上层与日志定位：
 *  - timeoutMs：生效的总预算
 *  - attempts：超时发生前已发起的尝试次数
 * message 里写清「已耗尽预算、未再重试」，是为了让值班的人一眼看出这不是
 * 一次普通的 DB 错误，而是被兜底拦下的挂起。
 */
export class DbOperationTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly attempts: number;

  constructor(timeoutMs: number, attempts: number) {
    super(
      `DB 操作超出总预算 ${timeoutMs}ms（已发起 ${attempts} 次尝试）：` +
        "预算已耗尽且未再重试，请求被兜底中断而非继续排队。",
    );
    this.name = "DbOperationTimeoutError";
    this.timeoutMs = timeoutMs;
    this.attempts = attempts;
  }
}

/**
 * 判断错误是否为可重试的连接级错误。
 *
 * **鸭子类型取舍**：原实现是 `error instanceof Prisma.PrismaClientKnownRequestError
 * && code ∈ {P1001, P1002, P1008}`。这里改为只检查 `error instanceof Error &&
 * typeof error.code === "string" && code ∈ RETRYABLE_DB_CODES`，理由是引入
 * Prisma 类会带上整个 @prisma/client 依赖（见文件头"为什么零依赖"）。
 *
 * 等价性：Prisma 的 PrismaClientKnownRequestError 继承 Error 且带 string 型
 * code 字段，因此原判据为真的输入，这里一定也为真。
 * 代价：任何**其他**带同名 code 字段的 Error 也会被当作可重试。实际不会发生
 * （P1001/P1002/P1008 是 Prisma 专用码），且即使发生也只是多退避重试几次，
 * 不会造成数据正确性问题——相比"判据失效后静默挂起"，这个代价是可接受的。
 */
export function isRetryableDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return (RETRYABLE_DB_CODES as readonly string[]).includes(code);
}

/**
 * 计算第 attempt 次重试前的退避时长（指数 + 抖动）。
 *
 * 保持原实现语义：DB_RETRY_DELAY_MS * 2 ** attempt，叠加 0–30% 抖动。
 *
 * @param attempt - 当前是第几次重试（0 基）
 * @param rand - 随机源，默认 Math.random；注入固定值可让测试确定化
 * @param baseDelayMs - 退避基数，默认 DB_RETRY_DELAY_MS；
 *   注入 delayMs 选项时用它替换，避免"接受选项却不生效"的静默缺失
 */
export function computeBackoffDelay(
  attempt: number,
  rand: () => number = Math.random,
  baseDelayMs: number = DB_RETRY_DELAY_MS,
): number {
  const base = baseDelayMs * 2 ** attempt;
  const jitter = rand() * base * JITTER_RATIO;
  return base + jitter;
}

/**
 * 读取总预算（毫秒）。
 *
 * 非法值（空串、NaN、≤0）回退默认值：预算配错不该让进程起不来，
 * 也不该把预算变成 0 导致每次操作都立刻超时。
 */
export function dbOpBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CORPS_DB_OP_BUDGET_MS;
  if (typeof raw !== "string" || raw.trim() === "") return DB_OP_BUDGET_MS_DEFAULT;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DB_OP_BUDGET_MS_DEFAULT;
  return Math.trunc(parsed);
}

/** 生产默认 sleep：真实定时器 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** runWithDbRetry 的可注入选项（注入点仅供测试，生产走默认） */
export interface DbRetryOptions {
  /** 总预算（毫秒）；默认读 CORPS_DB_OP_BUDGET_MS，回退 DB_OP_BUDGET_MS_DEFAULT */
  budgetMs?: number;
  /** 最大重试次数（不含首次尝试）；默认 DB_RETRY_MAX */
  maxRetries?: number;
  /** 退避基数（毫秒）；默认 DB_RETRY_DELAY_MS */
  delayMs?: number;
  /** 等待函数；默认真实 setTimeout */
  sleep?: (ms: number) => Promise<void>;
  /** 随机源；默认 Math.random */
  rand?: () => number;
  /** 时钟；默认 Date.now */
  now?: () => number;
}

/**
 * 在总预算内执行 DB 操作，连接级错误按指数退避重试。
 *
 * 控制流：
 *   1. deadline = now() + budgetMs（**总**预算，覆盖尝试 + 退避）
 *   2. 每次尝试：把 fn() 与"剩余预算"定时器 Promise.race
 *      → 超时抛 DbOperationTimeoutError，**终态，不重试**
 *   3. 可重试错误：重试次数用尽或剩余预算 ≤ 0 → 原样 rethrow；
 *      否则 sleep(min(backoff, 剩余预算)) 后继续
 *   4. 其他错误（P2002 等）→ 立即 rethrow
 *
 * 实现细节（两个坑）：
 *  - 落败的 fn() 稍后仍可能 reject，必须挂一个空 `.catch(() => {})`，
 *    否则会变成 unhandled rejection（Node 18+ 默认直接杀进程）。
 *  - finally 里必须 clearTimeout，否则每次调用都留一个到预算为止的活跃定时器。
 *
 * @throws {DbOperationTimeoutError} 总预算耗尽（终态）
 * @throws 原错误（不可重试，或重试次数/预算用尽）
 */
export async function runWithDbRetry<T>(
  fn: () => Promise<T>,
  opts: DbRetryOptions = {},
): Promise<T> {
  const budgetMs = opts.budgetMs ?? dbOpBudgetMs();
  const maxRetries = opts.maxRetries ?? DB_RETRY_MAX;
  const delayMs = opts.delayMs ?? DB_RETRY_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const rand = opts.rand ?? Math.random;
  const now = opts.now ?? Date.now;

  const deadline = now() + budgetMs;
  let attempt = 0;

  while (true) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      // 预算在上一轮退避里就花光了：直接判超时，不再发起新的尝试
      throw new DbOperationTimeoutError(budgetMs, attempt);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new DbOperationTimeoutError(budgetMs, attempt + 1));
        }, remaining);
      });
      const pending = fn();
      // fn() 在 race 中落败后仍会继续跑，并最终可能 reject；挂空 catch 兜住它
      pending.catch(() => {});
      return await Promise.race([pending, timeout]);
    } catch (error) {
      // 超时的"终态"由下面这条判据保证：DbOperationTimeoutError 不在
      // RETRYABLE_DB_CODES 里，所以 isRetryableDbError 为 false → 直接抛出。
      // **刻意不为超时单独写 `if (error instanceof DbOperationTimeoutError) throw`**
      // 的短路：那样做等于把"超时是否可重试"这件事变成死代码分支——
      // 有人把超时错误加进可重试集合时行为也不变（实测：加了短路后该变异 13/13
      // 全绿，即**等价变异**，任何测试都杀不掉），门禁就失去了对这条契约的
      // 证明力。判据只留一处，契约交给 db-retry.test.ts 的断言 10 守着。
      if (!isRetryableDbError(error) || attempt >= maxRetries) {
        throw error;
      }
      const left = deadline - now();
      if (left <= 0) {
        throw error;
      }
      // 退避时长截到剩余预算，绝不睡过头（睡过头就等于预算形同虚设）
      await sleep(Math.min(computeBackoffDelay(attempt, rand, delayMs), left));
      attempt += 1;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
