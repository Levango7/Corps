// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * db-retry 单元测试 —— 锁定「总预算兜底」与「超时是终态」两条新契约。
 *
 * 背景（DL-4 加固）：原 withDbRetry 只对 P1001/P1002/P1008 重试且**没有任何
 * 请求级超时**。ADR-014 的 Prisma 7 升级会改变连接池语义、P1008 可能不再出现；
 * 届时旧实现不会报错也不会告警，请求只是无限排队（日志全绿、监控无感）。
 * 因此新增总预算兜底：它不依赖任何 Prisma 错误码。
 *
 * Mock 策略（**无模块 mock，只注入**）：只 import lib/db-retry.ts（它刻意不依赖
 * @prisma/client，见同目录 db-pool.test.ts 的原因说明）。时间相关的三个副作用
 * ——sleep / rand / now——全部走 runWithDbRetry 的注入点，测试因此不需要真等
 * 退避，也不需要 fake timers 就能确定化。
 */

import {
  DB_OP_BUDGET_MS_DEFAULT,
  DB_RETRY_DELAY_MS,
  DB_RETRY_MAX,
  DbOperationTimeoutError,
  computeBackoffDelay,
  dbOpBudgetMs,
  isRetryableDbError,
  runWithDbRetry,
} from "@/lib/db-retry";

/** 造一个"像 Prisma 错误"的对象：Error 实例 + string 型 code 字段 */
function dbError(code: string): Error {
  return Object.assign(new Error(`prisma error ${code}`), { code });
}

/**
 * 构造 NodeJS.ProcessEnv 字面量。
 *
 * 不能裸传 `{}`：Next 在 node_modules/next/types/global.d.ts:21 给 ProcessEnv
 * 增强了**必填且只读**的 NODE_ENV，`{ CORPS_DB_OP_BUDGET_MS: "8000" }` 缺属性，
 * `tsc --noEmit` 会红。签名保持 NodeJS.ProcessEnv 不变，由测试侧补齐。
 */
function envOf(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...extra, NODE_ENV: "test" };
}

/** 可注入的假时钟：t 只在 sleep 里前进，模拟"退避也消耗预算" */
function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

describe("runWithDbRetry —— 成功与重试计数", () => {
  it("成功路径：一次返回，不重试（断言 6）", async () => {
    const clock = fakeClock();
    let calls = 0;
    const out = await runWithDbRetry(
      async () => {
        calls += 1;
        return "ok";
      },
      { budgetMs: 10_000, sleep: clock.sleep, now: clock.now, rand: () => 0 },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(1);
    expect(clock.sleeps).toHaveLength(0);
  });

  it("P1001 连抛：恰好重试 DB_RETRY_MAX 次后抛出原错误（断言 7）", async () => {
    const clock = fakeClock();
    const boom = dbError("P1001");
    let calls = 0;
    await expect(
      runWithDbRetry(
        async () => {
          calls += 1;
          throw boom;
        },
        { budgetMs: 60_000, sleep: clock.sleep, now: clock.now, rand: () => 0 },
      ),
    ).rejects.toBe(boom);
    // 1 次首发 + DB_RETRY_MAX 次重试
    expect(calls).toBe(DB_RETRY_MAX + 1);
    expect(clock.sleeps).toHaveLength(DB_RETRY_MAX);
    // 指数退避：500 / 1000 / 2000（rand()=0 时无抖动）
    expect(clock.sleeps).toEqual([500, 1000, 2000]);
  });

  it("P2002：立即抛出，重试次数为 0（断言 8）", async () => {
    const clock = fakeClock();
    const boom = dbError("P2002");
    let calls = 0;
    await expect(
      runWithDbRetry(
        async () => {
          calls += 1;
          throw boom;
        },
        { budgetMs: 60_000, sleep: clock.sleep, now: clock.now, rand: () => 0 },
      ),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
    expect(clock.sleeps).toHaveLength(0);
  });

  it("无 code 字段的普通 Error：不重试", async () => {
    const clock = fakeClock();
    let calls = 0;
    await expect(
      runWithDbRetry(
        async () => {
          calls += 1;
          throw new Error("plain");
        },
        { budgetMs: 60_000, sleep: clock.sleep, now: clock.now, rand: () => 0 },
      ),
    ).rejects.toThrow("plain");
    expect(calls).toBe(1);
    expect(clock.sleeps).toHaveLength(0);
  });
});

describe("runWithDbRetry —— 总预算兜底", () => {
  /** 永不 settle 的 fn：模拟 Prisma 不抛 P1008、请求无限排队的场景 */
  function neverSettles(counter: { calls: number }) {
    return () => {
      counter.calls += 1;
      return new Promise<never>(() => {});
    };
  }

  /**
   * 固定时钟（now 恒为 0）。
   *
   * 为什么不用真实时钟：超时定时器是按真实时间触发的，等它触发时剩余预算
   * 已经 ≈ 0，于是"超时后是否重试"会先被另一条判据 `left <= 0` 拦下——
   * 即使有人把 DbOperationTimeoutError 加进可重试集合（变异 M2），也会被
   * 这条判据救回绿灯，**变异杀不掉**。
   * 固定时钟让剩余预算始终 > 0，从而把"超时是终态"这条契约单独隔离出来：
   * 一旦超时被判为可重试，fn 就一定会被再调一次（断言 10 立刻变红）。
   */
  const fixedNow = () => 0;

  it("fn 永不 settle：预算耗尽后 reject 为 DbOperationTimeoutError（断言 9）", async () => {
    const counter = { calls: 0 };
    // budgetMs 取 10ms：真实定时器，但用例不因此变慢（只等 10ms）
    await expect(
      runWithDbRetry(neverSettles(counter), { budgetMs: 10, now: fixedNow }),
    ).rejects.toBeInstanceOf(DbOperationTimeoutError);
  });

  it("超时错误带上预算与尝试次数，message 写明未再重试", async () => {
    const counter = { calls: 0 };
    try {
      await runWithDbRetry(neverSettles(counter), { budgetMs: 10, now: fixedNow });
      expect.unreachable("预算耗尽应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(DbOperationTimeoutError);
      const timeout = error as DbOperationTimeoutError;
      expect(timeout.timeoutMs).toBe(10);
      expect(timeout.attempts).toBe(1);
      expect(timeout.name).toBe("DbOperationTimeoutError");
      expect(timeout.message).toContain("未再重试");
    }
  });

  it("超时是终态：fn 只被调用 1 次，不重试（断言 10）", async () => {
    const counter = { calls: 0 };
    await expect(
      runWithDbRetry(neverSettles(counter), { budgetMs: 10, now: fixedNow }),
    ).rejects.toBeInstanceOf(DbOperationTimeoutError);
    // 若超时可被重试，这里会 ≥2（真实 sleep 走默认定时器，等它排完再断言）
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(counter.calls).toBe(1);
  });

  it("退避上界：剩余预算小于 backoff 时 sleep 被截短，不会睡过头（断言 11）", async () => {
    const clock = fakeClock();
    let calls = 0;
    // 预算 400ms。首次失败发生在 t=0，剩余 400；rand()=1 让抖动拉满，
    // backoff = 500 * 1.3 = 650 > 400，因此必须被截到 400——睡过头就等于预算形同虚设
    await expect(
      runWithDbRetry(
        async () => {
          calls += 1;
          throw dbError("P1001");
        },
        { budgetMs: 400, sleep: clock.sleep, now: clock.now, rand: () => 1 },
      ),
    ).rejects.toBeInstanceOf(DbOperationTimeoutError);
    // 首轮：backoff = 500 * 1.3 = 650 → 截到剩余 400
    expect(clock.sleeps[0]).toBe(400);
    expect(clock.sleeps[0]).toBeLessThan(650);
    // 次轮：剩余 0 → 不再发起尝试，直接判超时
    expect(calls).toBe(1);
  });

  it("退避被 delayMs 选项替换时确实生效（防止选项被接受却不生效）", async () => {
    const clock = fakeClock();
    await expect(
      runWithDbRetry(
        async () => {
          throw dbError("P1001");
        },
        {
          budgetMs: 60_000,
          delayMs: 100,
          sleep: clock.sleep,
          now: clock.now,
          rand: () => 0,
        },
      ),
    ).rejects.toThrow("prisma error P1001");
    expect(clock.sleeps).toEqual([100, 200, 400]);
  });
});

describe("runWithDbRetry —— 不会漏出 unhandled rejection", () => {
  it("落败的 fn 稍后 reject：不产生 unhandled rejection（断言 12）", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      // fn 在 40ms 后 reject，但预算只有 10ms —— race 早已落败
      await expect(
        runWithDbRetry(
          () =>
            new Promise<never>((_resolve, reject) => {
              setTimeout(() => reject(dbError("P1001")), 40);
            }),
          { budgetMs: 10 },
        ),
      ).rejects.toBeInstanceOf(DbOperationTimeoutError);
      // 等到那个迟到的 rejection 真的发生之后再断言
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toHaveLength(0);
  });
});

describe("判定与计算的纯函数", () => {
  it("isRetryableDbError：鸭子类型判定（不依赖 Prisma 类）", () => {
    expect(isRetryableDbError(dbError("P1001"))).toBe(true);
    expect(isRetryableDbError(dbError("P1002"))).toBe(true);
    expect(isRetryableDbError(dbError("P1008"))).toBe(true);
    expect(isRetryableDbError(dbError("P2002"))).toBe(false);
    expect(isRetryableDbError(new Error("no code"))).toBe(false);
    expect(isRetryableDbError("P1001")).toBe(false); // 非 Error
    expect(isRetryableDbError(null)).toBe(false);
  });

  it("computeBackoffDelay：指数退避 + 0–30% 抖动，rand 可注入确定化", () => {
    expect(computeBackoffDelay(0, () => 0)).toBe(DB_RETRY_DELAY_MS);
    expect(computeBackoffDelay(1, () => 0)).toBe(DB_RETRY_DELAY_MS * 2);
    expect(computeBackoffDelay(2, () => 0)).toBe(DB_RETRY_DELAY_MS * 4);
    // 抖动上限 30%
    expect(computeBackoffDelay(0, () => 1)).toBe(DB_RETRY_DELAY_MS * 1.3);
    // 自定义基数
    expect(computeBackoffDelay(1, () => 0, 100)).toBe(200);
  });

  it("dbOpBudgetMs：默认值与非法值回退", () => {
    expect(dbOpBudgetMs(envOf())).toBe(DB_OP_BUDGET_MS_DEFAULT);
    expect(dbOpBudgetMs(envOf({ CORPS_DB_OP_BUDGET_MS: "" }))).toBe(DB_OP_BUDGET_MS_DEFAULT);
    expect(dbOpBudgetMs(envOf({ CORPS_DB_OP_BUDGET_MS: "abc" }))).toBe(DB_OP_BUDGET_MS_DEFAULT);
    expect(dbOpBudgetMs(envOf({ CORPS_DB_OP_BUDGET_MS: "0" }))).toBe(DB_OP_BUDGET_MS_DEFAULT);
    expect(dbOpBudgetMs(envOf({ CORPS_DB_OP_BUDGET_MS: "-5" }))).toBe(DB_OP_BUDGET_MS_DEFAULT);
    expect(dbOpBudgetMs(envOf({ CORPS_DB_OP_BUDGET_MS: "8000" }))).toBe(8000);
  });
});
