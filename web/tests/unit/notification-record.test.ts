// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { notifyUsers, type NotifyRow } from "@/lib/notification/record";

/**
 * notifyUsers 单测 —— 钉住「跨用户站内通知不能用 create」这条由 RLS 推出的写法约束。
 *
 * 背景（2026-10-06 在 hardened 腿实测）：Prisma 的 create 发的是 `INSERT … RETURNING`，
 * 而 PostgreSQL 要求 RETURNING 的行再过一遍该表的 SELECT 策略；notifications 的 SELECT
 * 策略是 `user_id = app.user_id`（DL-17）。事务里 app.user_id = 操作者、接收者是别人时
 * ⇒ 42501 ⇒ 端点整体 500。证据链见 docs/audit/RLS-CROSS-USER-NOTIFY-2026-10-07.md。
 *
 * 所以本文件不是测"能不能写库"，而是测**写法**：一旦有人把 helper 改回 create，
 * fakeTx 里的 create 会抛出 hardened 腿的真实错误形态，用例必红。
 */

type NotifyTx = Parameters<typeof notifyUsers>[0];

function row(over: Partial<NotifyRow> = {}): NotifyRow {
  return {
    userId: "u-1",
    workspaceId: "w-1",
    type: "approval_cc",
    entityId: "e-1",
    entityTitle: "标题",
    ...over,
  };
}

function fakeTx(): {
  createMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  tx: NotifyTx;
} {
  const createMany = vi.fn(async () => ({ count: 0 }));
  const create = vi.fn(async () => {
    throw new Error('new row violates row-level security policy for table "notifications"');
  });
  const tx = { notification: { createMany, create } } as unknown as NotifyTx;
  return { createMany, create, tx };
}

describe("notifyUsers（跨用户站内通知写入）", () => {
  it("走 createMany，并把库回报的行数原样返回", async () => {
    const { createMany, tx } = fakeTx();
    createMany.mockImplementation(async () => ({ count: 2 }));

    const n = await notifyUsers(tx, [row(), row({ userId: "u-2" })]);

    expect(n).toBe(2);
    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = createMany.mock.calls[0]?.[0] as { data: NotifyRow[] } | undefined;
    expect(arg?.data).toHaveLength(2);
    expect(arg?.data[1]?.userId).toBe("u-2");
  });

  it("绝不使用 create（改回 create 就等于把 42501 请回来）", async () => {
    const { create, tx } = fakeTx();

    await notifyUsers(tx, [row()]);

    expect(create).not.toHaveBeenCalled();
  });

  it("空输入不碰数据库，直接返回 0", async () => {
    const { createMany, tx } = fakeTx();

    expect(await notifyUsers(tx, [])).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });
});
