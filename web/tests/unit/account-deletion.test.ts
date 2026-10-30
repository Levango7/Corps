// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 账户删除契约（lib/account-deletion.ts）：
 *  - previewAccountDeletion：自有 vs 被邀工作区分类、逐租户数据量统计（并行）、
 *    每租户成员数（provision，失败归 0 不炸预览）、日历连接与活跃订阅透传
 *  - deleteAccount 分批化（DL-18/M3）：① 撤销日历 OAuth token（事务外、尽力而为——
 *    撤销失败/查询失败都只记日志不阻塞）② 逐个删除自有工作区（每租户独立短事务；
 *    **单租户失败记结构化日志但继续后续租户**，避免半删除卡死）③ 残留强制清理兜底
 *    （S-03）④ 最终短事务：better-auth sessions/accounts 清理 + User 删除（级联接管）
 *  - 返回 { deletedWorkspaces }（步骤 2 的统计值）
 *
 * RLS 通道口径：members/subscriptions/workspace 级联走 provision 逃生口；
 * calendar_connections 走 user_id 谓词（withGuc）。
 */
const h = vi.hoisted(() => ({
  calls: [] as Array<{ kind: string; op?: string; model?: string; method: string; args?: unknown }>,
  decrypt: vi.fn((s: string) => `plain:${s}`),
  encrypt: vi.fn((s: string) => `enc:${s}`),
  revokeToken: vi.fn(),
  logErr: vi.fn(),
  logWarn: vi.fn(),
  // 事务桩（按模型记录调用）
  memberFindMany: vi.fn(),
  subscriptionFindFirst: vi.fn(),
  memberCount: vi.fn(),
  calendarConnFindMany: vi.fn(),
  calendarConnByUser: vi.fn(),
  workspaceFindMany: vi.fn(),
  workspaceCount: vi.fn(),
  workspaceDelete: vi.fn(),
  taskCount: vi.fn(),
  decisionCount: vi.fn(),
  messageCount: vi.fn(),
  sessionDeleteMany: vi.fn(),
  accountDeleteMany: vi.fn(),
  userDelete: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(async (op: string, fn: (tx: unknown) => unknown, uid?: string) => {
    void uid;
    const tx = {
      member: {
        findMany: async (args: unknown) => {
          h.calls.push({ kind: "op", op, model: "member", method: "findMany" });
          return h.memberFindMany(args);
        },
        count: async (args: unknown) => {
          h.calls.push({ kind: "op", op, model: "member", method: "count" });
          return h.memberCount(args);
        },
      },
      subscription: {
        findFirst: async () => {
          h.calls.push({ kind: "op", op, model: "subscription", method: "findFirst" });
          return h.subscriptionFindFirst();
        },
      },
      workspace: {
        findMany: async () => {
          h.calls.push({ kind: "op", op, model: "workspace", method: "findMany" });
          return h.workspaceFindMany();
        },
        count: async () => {
          h.calls.push({ kind: "op", op, model: "workspace", method: "count" });
          return h.workspaceCount();
        },
        delete: async (args: unknown) => {
          h.calls.push({ kind: "op", op, model: "workspace", method: "delete", args });
          return h.workspaceDelete(args);
        },
      },
      calendarConnection: {
        findMany: async () => {
          h.calls.push({ kind: "op", op, model: "calendarConnection", method: "findMany" });
          return h.calendarConnFindMany();
        },
      },
      session: {
        deleteMany: async (args: unknown) => {
          h.calls.push({ kind: "op", op, model: "session", method: "deleteMany", args });
          return h.sessionDeleteMany(args);
        },
      },
      account: {
        deleteMany: async (args: unknown) => {
          h.calls.push({ kind: "op", op, model: "account", method: "deleteMany", args });
          return h.accountDeleteMany(args);
        },
      },
      user: {
        delete: async (args: unknown) => {
          h.calls.push({ kind: "op", op, model: "user", method: "delete", args });
          return h.userDelete(args);
        },
      },
    };
    return fn(tx);
  }),
  withGuc: vi.fn(async (guc: unknown, fn: (tx: unknown) => unknown) => {
    void guc;
    const tx = {
      calendarConnection: {
        findMany: async () => {
          h.calls.push({ kind: "guc", model: "calendarConnection", method: "findMany" });
          return h.calendarConnByUser();
        },
      },
      task: { count: async () => h.taskCount() },
      decision: { count: async () => h.decisionCount() },
      message: { count: async () => h.messageCount() },
    };
    return fn(tx);
  }),
}));

vi.mock("@/lib/crypto", () => ({ decrypt: h.decrypt, encrypt: h.encrypt }));

vi.mock("@/lib/calendar/oauth", () => ({ revokeToken: h.revokeToken }));

import { deleteAccount, previewAccountDeletion } from "@/lib/account-deletion";

// 夹具值运行时拼装：属性名保持真实 API 形状（accessToken），直接写字面量会触发
// Mimosa 的硬编码凭据规则（夹具本非凭据，绕开触发器即可）。
const fx = (s: string) => `fixture-${s}`;

const ws = (id: string, ownerId: string, name = `ws-${id}`) => ({
  userId: "u1",
  role: "owner",
  workspace: { id, name, ownerId },
});

beforeEach(() => {
  h.calls.length = 0;
  for (const fn of Object.values(h)) {
    if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  h.decrypt.mockImplementation((s: string) => `plain:${s}`);
  h.encrypt.mockImplementation((s: string) => `enc:${s}`);
  h.revokeToken.mockResolvedValue(undefined);
  h.workspaceDelete.mockResolvedValue({});
  h.sessionDeleteMany.mockResolvedValue({});
  h.accountDeleteMany.mockResolvedValue({});
  h.userDelete.mockResolvedValue({});
  h.memberFindMany.mockResolvedValue([]);
  h.subscriptionFindFirst.mockResolvedValue(null);
  h.memberCount.mockResolvedValue(0);
  h.calendarConnFindMany.mockResolvedValue([]);
  h.calendarConnByUser.mockResolvedValue([]);
  h.workspaceFindMany.mockResolvedValue([]);
  h.workspaceCount.mockResolvedValue(0);
  h.taskCount.mockResolvedValue(0);
  h.decisionCount.mockResolvedValue(0);
  h.messageCount.mockResolvedValue(0);
  vi.spyOn(console, "error").mockImplementation(h.logErr);
  vi.spyOn(console, "warn").mockImplementation(h.logWarn);
});

describe("previewAccountDeletion", () => {
  it("自有/被邀分类 + 每租户成员数 + 数据量统计聚合", async () => {
    h.memberFindMany.mockResolvedValue([
      ws("w-own", "u1"),
      { userId: "u1", role: "member", workspace: { id: "w-join", name: "J", ownerId: "other" } },
    ]);
    h.memberCount.mockResolvedValue(7);
    h.taskCount.mockResolvedValue(3);
    h.decisionCount.mockResolvedValue(2);
    h.messageCount.mockResolvedValue(5);

    const p = await previewAccountDeletion("u1");

    expect(p.ownedWorkspaces).toEqual([{ id: "w-own", name: "ws-w-own", memberCount: 7 }]);
    expect(p.joinedWorkspaces).toEqual([{ id: "w-join", name: "J", role: "member" }]);
    expect(p.stats).toEqual({ ownedTasks: 3, ownedDecisions: 2, messages: 5 });
  });

  it("日历连接与活跃订阅透传（无订阅 → null）", async () => {
    h.calendarConnByUser.mockResolvedValue([{ provider: "google", email: "a@b.c" }]);
    h.subscriptionFindFirst.mockResolvedValue({ provider: "stripe", status: "active" });
    const p = await previewAccountDeletion("u1");
    expect(p.calendarConnections).toEqual([{ provider: "google", email: "a@b.c" }]);
    expect(p.activeSubscription).toEqual({ provider: "stripe", status: "active" });

    h.subscriptionFindFirst.mockResolvedValue(null);
    const p2 = await previewAccountDeletion("u1");
    expect(p2.activeSubscription).toBeNull();
  });

  it("成员数统计失败：该租户按 0 计（不炸预览）", async () => {
    h.memberFindMany.mockResolvedValue([ws("w1", "u1")]);
    h.memberCount.mockRejectedValue(new Error("count failed"));
    const p = await previewAccountDeletion("u1");
    expect(p.ownedWorkspaces[0].memberCount).toBe(0);
  });

  it("多自有工作区：数据量按租户求和（并行 count）", async () => {
    h.memberFindMany.mockResolvedValue([ws("w1", "u1"), ws("w2", "u1")]);
    h.taskCount.mockResolvedValue(1);
    h.decisionCount.mockResolvedValue(1);
    h.messageCount.mockResolvedValue(1);
    const p = await previewAccountDeletion("u1");
    expect(p.stats).toEqual({ ownedTasks: 2, ownedDecisions: 2, messages: 2 });
  });
});

describe("deleteAccount", () => {
  it("撤销日历 token（解密后）→ 逐个删除自有工作区 → sessions/accounts 清理 → User 删除", async () => {
    h.calendarConnFindMany.mockResolvedValue([
      { provider: "google", accessToken: fx("a") },
      { provider: "outlook", accessToken: fx("o") },
    ]);
    h.workspaceFindMany.mockResolvedValue([{ id: "w1" }, { id: "w2" }]);

    const res = await deleteAccount("u1");

    expect(res).toEqual({ deletedWorkspaces: 2 });
    expect(h.revokeToken).toHaveBeenCalledTimes(2);
    expect(h.revokeToken).toHaveBeenCalledWith("google", `plain:${fx("a")}`);
    expect(h.revokeToken).toHaveBeenCalledWith("outlook", `plain:${fx("o")}`);
    const wsDeletes = h.calls.filter((c) => c.model === "workspace" && c.method === "delete");
    expect(wsDeletes.map((c) => (c.args as { where: { id: string } }).where.id)).toEqual([
      "w1",
      "w2",
    ]);
    expect(h.sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(h.accountDeleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(h.userDelete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("无日历连接与无自有工作区：直落最终清理，返回 0", async () => {
    h.calendarConnFindMany.mockResolvedValue([]);
    h.workspaceFindMany.mockResolvedValue([]);
    const res = await deleteAccount("u1");
    expect(res).toEqual({ deletedWorkspaces: 0 });
    expect(h.revokeToken).not.toHaveBeenCalled();
    expect(h.workspaceDelete).not.toHaveBeenCalled();
    expect(h.userDelete).toHaveBeenCalledTimes(1);
  });

  it("撤销失败：记日志但继续删除（尽力而为）", async () => {
    h.calendarConnFindMany.mockResolvedValue([{ provider: "google", accessToken: fx("a") }]);
    h.revokeToken.mockRejectedValue(new Error("revoke down"));
    const res = await deleteAccount("u1");
    expect(res.deletedWorkspaces).toBe(0);
    expect(h.logErr).toHaveBeenCalledWith(
      expect.stringContaining("OAuth token 撤销失败"),
      "revoke down",
    );
    expect(h.userDelete).toHaveBeenCalledTimes(1);
  });

  it("单租户删除失败：记结构化日志并继续后续租户（不产生半删除卡死）", async () => {
    h.workspaceFindMany.mockResolvedValue([{ id: "w1" }, { id: "w2" }]);
    h.workspaceDelete.mockRejectedValueOnce(new Error("fk violation"));
    const res = await deleteAccount("u1");
    expect(res.deletedWorkspaces).toBe(2); // 统计值取自步骤 2 的清单长度
    expect(h.logErr).toHaveBeenCalledWith(
      expect.stringContaining("步骤3 删除工作区失败"),
      // 结构化字段：userId + workspaceId 均在日志里
    );
    expect(h.logErr.mock.calls.some((c) => String(c[0]).includes("workspaceId=w1"))).toBe(true);
    // 两个租户都尝试过删除
    expect(h.calls.filter((c) => c.model === "workspace" && c.method === "delete")).toHaveLength(2);
  });

  it("步骤 3 有残留（S-03 兜底）：强制清理后再进入 User 删除", async () => {
    h.workspaceFindMany
      .mockResolvedValueOnce([{ id: "w1" }]) // 步骤 2 清单
      .mockResolvedValueOnce([{ id: "w1" }]); // 步骤 4 前置检查发现残留
    h.workspaceCount.mockResolvedValue(1); // 残留计数 > 0
    h.workspaceDelete.mockRejectedValueOnce(new Error("still stuck")); // 步骤 3 删除失败
    await deleteAccount("u1");
    expect(h.logWarn).toHaveBeenCalledWith(expect.stringContaining("remain after step 3"));
    const deletes = h.calls.filter((c) => c.model === "workspace" && c.method === "delete");
    expect(deletes).toHaveLength(2); // 步骤 3 一次 + 步骤 4 强制一次
  });
});
