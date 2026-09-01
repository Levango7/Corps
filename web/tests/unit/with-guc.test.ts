// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * withGuc 单元测试 —— 覆盖 RLS 事务助手的事务参数与 GUC 注入行为。
 *
 * 背景（2026-09-01 修复）：withGuc 是 lib/auth.ts 中所有 RLS 交互式事务的
 * 唯一入口。交互式事务独占一个池连接，Prisma 默认 maxWait=2000ms 在并发请求
 * 集中、连接池渐进建连时会过早超时（P2028，概览/任务/事件接口间歇性 500）。
 * 修复：显式传 { maxWait: 10_000, timeout: 20_000 }。
 *
 * 本测试锁定两条契约：
 *  1. 事务选项必须携带宽松的 maxWait/timeout（防回归——有人改回 2000ms 即红）。
 *  2. GUC 注入语义：白名单 key 映射固定 SQL、undefined 跳过、未知 key 抛错。
 *
 * Mock 策略（只 mock 叶子依赖，被测 withGuc / setGucs 走真实实现）：
 *  - @/lib/prisma：$transaction 记录 (fn, options) 并直接执行 fn(tx)。
 *  - @/lib/jwt、@/lib/email、better-auth 系列：让 auth.ts 模块加载不触发
 *    betterAuth 真实构造副作用。
 */

// vi.hoisted：让 mock 工厂与测试体共享同一 mock 对象
const txMock = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn<() => Promise<unknown>>(async () => undefined),
}));

const jwtMock = vi.hoisted(() => ({
  verifyAccessToken: vi.fn<() => Promise<unknown>>(async () => null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // 记录 (fn, options)，并直接执行 fn(tx) 等价真实事务内执行。
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock)),
  },
}));

vi.mock("@/lib/jwt", () => ({
  verifyAccessToken: jwtMock.verifyAccessToken,
}));

vi.mock("@/lib/email", () => ({
  sendResetPasswordEmail: vi.fn(async () => undefined),
}));

vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({})),
}));

vi.mock("better-auth/adapters/prisma", () => ({
  prismaAdapter: vi.fn(() => ({})),
}));

// betterAuth 虽已 mock，仍注入 env 避免任何未拦截构造路径抛错（与 auth-wid-guard 同风格）。
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-for-with-guc-only-0123456789abcdef";
process.env.JWT_ACCESS_SECRET = "test-jwt-secret-for-with-guc-only-0123456789abcdef";

const { withGuc } = await import("@/lib/auth");
const { prisma } = await import("@/lib/prisma");

const prismaTx = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  txMock.$executeRawUnsafe.mockReset();
  // mockClear：保留工厂里 "直接执行 fn(tx)" 的实现，仅清调用记录
  prismaTx.mockClear();
  txMock.$executeRawUnsafe.mockResolvedValue(undefined);
});

describe("withGuc - 事务选项（连接池修复回归保护）", () => {
  it("以宽松 maxWait/timeout 调用 $transaction（防并发 P2028 复发）", async () => {
    // Act
    await withGuc({ auth_op: "provision" }, async () => "ok");

    // Assert：第二参数即事务选项
    expect(prismaTx).toHaveBeenCalledTimes(1);
    const options = prismaTx.mock.calls[0][1];
    expect(options).toEqual({ maxWait: 10_000, timeout: 20_000 });
  });

  it("事务回调按顺序先注入 GUC 再执行业务 fn", async () => {
    const order: string[] = [];
    txMock.$executeRawUnsafe.mockImplementation(async () => {
      order.push("guc");
    });

    await withGuc({ auth_op: "provision", user_id: "u-1" }, async () => {
      order.push("fn");
      return 42;
    });

    // GUC SQL 与值逐一注入
    expect(txMock.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.auth_op', $1, true)",
      "provision",
    );
    expect(txMock.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.user_id', $1, true)",
      "u-1",
    );
    // 先 GUC 后业务
    expect(order).toEqual(["guc", "guc", "fn"]);
  });

  it("透传业务 fn 的返回值", async () => {
    const result = await withGuc({ auth_op: "provision" }, async () => ({ ok: true, n: 7 }));
    expect(result).toEqual({ ok: true, n: 7 });
  });
});

describe("withGuc - GUC 注入语义", () => {
  it("值为 undefined 的 GUC 被跳过（不执行 $executeRawUnsafe）", async () => {
    await withGuc(
      { auth_op: "provision", user_id: undefined, workspace_id: "ws-A" },
      async () => null,
    );

    // 只注入 auth_op 与 workspace_id 两个
    expect(txMock.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(txMock.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.auth_op', $1, true)",
      "provision",
    );
    expect(txMock.$executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT set_config('app.workspace_id', $1, true)",
      "ws-A",
    );
  });

  it("空 GUC 对象不触发任何注入", async () => {
    await withGuc({}, async () => null);
    expect(txMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("未知 GUC key 抛出错误（白名单约束，防 SQL 拼接注入）", async () => {
    await expect(
      withGuc({ evil_key: "x" } as never, async () => null),
    ).rejects.toThrow("未知的 RLS GUC key: evil_key");
    // 抛错前不执行任何注入
    expect(txMock.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});
