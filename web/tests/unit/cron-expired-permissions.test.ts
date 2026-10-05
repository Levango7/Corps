import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 过期临时授权回收 cron（/api/cron/check-expired-permissions）。
 *
 * 要钉住的是那条容易被"顺手简化"掉的守卫：恢复角色时必须限定
 * `AND role = tempRole`。少了这一格，用户在临时授权期间被手动改过角色
 * （或成员已被移除）也会被 cron 覆写回 originalRole —— 而这一步是
 * 绕过 RLS 的 $executeRaw，没有任何别的机制会拦它。
 *
 * 顺带钉：未配置 CRON_SECRET / Bearer 不匹配都不得碰库；
 * 过期判据是 expiresAt < now；扫描到的每条授权记录最终都被删除。
 */

const SECRET = "cron-secret-value";

const h = vi.hoisted(() => ({
  runWithAuthOp: vi.fn(),
  findMany: vi.fn(),
  delete_: vi.fn(),
  raw: vi.fn(),
  rawCalls: [] as { sql: string; values: unknown[] }[],
}));

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: h.runWithAuthOp,
}));

import { GET } from "@/app/api/cron/check-expired-permissions/route";

type Grant = {
  id: string;
  userId: string;
  workspaceId: string;
  tempRole: string;
  originalRole: string;
};

const G1: Grant = {
  id: "g-1",
  userId: "u-1",
  workspaceId: "w-1",
  tempRole: "admin",
  originalRole: "member",
};
const G2: Grant = {
  id: "g-2",
  userId: "u-2",
  workspaceId: "w-2",
  tempRole: "member",
  originalRole: "viewer",
};

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/check-expired-permissions", {
    headers,
  });
}

/** 让 runWithAuthOp 真正执行回调，并把 tx 换成探针 */
function installTx(grants: Grant[], updateResults: number[]) {
  h.rawCalls.length = 0;
  h.findMany.mockResolvedValue(grants);
  h.delete_.mockResolvedValue(undefined);
  h.raw.mockImplementation(() => Promise.resolve(updateResults.shift() ?? 0));
  h.runWithAuthOp.mockImplementation(async (_op: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      temporaryGrant: { findMany: h.findMany, delete: h.delete_ },
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        h.rawCalls.push({ sql: strings.join("?"), values });
        return h.raw();
      },
    }),
  );
}

async function json(res: Response) {
  return (await res.json()) as { code: number; data?: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("check-expired-permissions 的鉴权门", () => {
  it("未配置 CRON_SECRET 时 500，且不进入事务", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(500);
    expect(h.runWithAuthOp).not.toHaveBeenCalled();
  });

  it("Bearer 不匹配时 401，且不进入事务", async () => {
    const res = await GET(req({ authorization: `Bearer ${SECRET}-wrong` }));
    expect(res.status).toBe(401);
    expect(h.runWithAuthOp).not.toHaveBeenCalled();

    const noHeader = await GET(req());
    expect(noHeader.status).toBe(401);
  });

  it("鉴权通过时以 cron 身份开事务", async () => {
    installTx([], []);
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect(h.runWithAuthOp).toHaveBeenCalledWith("cron", expect.any(Function));
  });
});

describe("check-expired-permissions 的角色恢复守卫", () => {
  it("UPDATE 必须带 role = tempRole 守卫，参数顺序与占位符一致", async () => {
    installTx([G1], [1]);
    await GET(req({ authorization: `Bearer ${SECRET}` }));

    expect(h.rawCalls).toHaveLength(1);
    const { sql, values } = h.rawCalls[0];
    expect(sql).toContain("SET role = ?");
    // 这一格就是守卫本体：少写它，手动改过角色的人会被 cron 覆写
    expect(sql).toContain("AND role = ?");
    expect(values).toEqual([G1.originalRole, G1.userId, G1.workspaceId, G1.tempRole]);
  });

  it("当前角色已变（0 行受影响）时计入 skipped 而不是 restored", async () => {
    installTx([G1, G2], [1, 0]);
    const body = await json(await GET(req({ authorization: `Bearer ${SECRET}` })));
    expect(body.data).toEqual({ checked: 2, restored: 1, skipped: 1 });
  });

  it("过期判据是 expiresAt < now，且授权记录无论是否恢复都清掉", async () => {
    installTx([G1, G2], [0, 0]);
    await GET(req({ authorization: `Bearer ${SECRET}` }));

    const where = h.findMany.mock.calls[0][0] as {
      where: { expiresAt: { lt: Date } };
    };
    expect(where.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(h.delete_.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id)).toEqual([
      "g-1",
      "g-2",
    ]);
  });

  it("空扫描结果返回全 0，不发 UPDATE", async () => {
    installTx([], []);
    const body = await json(await GET(req({ authorization: `Bearer ${SECRET}` })));
    expect(body).toEqual({ code: 200, data: { checked: 0, restored: 0, skipped: 0 } });
    expect(h.raw).not.toHaveBeenCalled();
  });

  it("库里抛错时 500，不返回半成品计数", async () => {
    installTx([G1], []);
    h.delete_.mockRejectedValue(new Error("delete failed"));
    const res = await GET(req({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.data).toBeNull();
  });
});
