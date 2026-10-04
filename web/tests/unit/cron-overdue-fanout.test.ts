import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 逾期 cron 的离线扇出接线测试。
 *
 * 这是 dispatchOfflineNotification 长期"零调用方"之后接上的第一个点位，
 * 要钉住三件事：
 *  1. 用的是 fanOutOfflineEmail（只发信），不是 dispatchOfflineNotification
 *     ——cron 已经在自己事务里落过 Notification 行，用后者会让站内通知重复一条。
 *  2. 扇出必须发生在事务回调结束之后（SMTP 网络 IO 不能进 RLS 事务）。
 *  3. 响应形状仍是 {checked,notified,skipped}：内部收集的目标不能漏进契约。
 */

const h = vi.hoisted(() => {
  const log: string[] = [];
  return {
    log,
    findMany: vi.fn(),
    notificationFindFirst: vi.fn(),
    notificationCreate: vi.fn(),
    fanOut: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(async (_op: string, fn: (tx: unknown) => Promise<unknown>) => {
    h.log.push("tx:begin");
    const out = await fn({
      decisionActionItem: { findMany: h.findMany },
      notification: { findFirst: h.notificationFindFirst, create: h.notificationCreate },
    });
    h.log.push("tx:end");
    return out;
  }),
  runWithWorkspace: vi.fn(),
}));

vi.mock("@/lib/notification/offline-push", () => ({
  fanOutOfflineEmail: h.fanOut,
}));

import { GET } from "@/app/api/cron/check-overdue-actions/route";

const SECRET = "test-cron-secret";

function makeReq() {
  return new NextRequest("http://localhost:3000/api/cron/check-overdue-actions", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

const ITEM_WITH_ASSIGNEE = {
  id: "ai-1",
  assigneeId: "u-assignee",
  dueDate: new Date("2026-01-01"),
  decision: { workspaceId: "w-1" },
  task: { id: "t-1", title: "把发布说明写完" },
};

const ITEM_NO_ASSIGNEE = {
  id: "ai-2",
  assigneeId: null,
  dueDate: new Date("2026-01-01"),
  decision: { workspaceId: "w-1" },
  task: { id: "t-2", title: "无指派人" },
};

const ITEM_ALREADY_NOTIFIED = {
  id: "ai-3",
  assigneeId: "u-assignee",
  dueDate: new Date("2026-01-01"),
  decision: { workspaceId: "w-1" },
  task: { id: "t-3", title: "已经通知过" },
};

beforeEach(() => {
  h.log.length = 0;
  vi.stubEnv("CRON_SECRET", SECRET);
  h.findMany.mockResolvedValue([ITEM_WITH_ASSIGNEE, ITEM_NO_ASSIGNEE, ITEM_ALREADY_NOTIFIED]);
  // ai-3 已有逾期通知，ai-1 没有
  h.notificationFindFirst.mockImplementation(async (args: { where: { entityId: string } }) =>
    args.where.entityId === ITEM_ALREADY_NOTIFIED.id ? { id: "n-old" } : null,
  );
  h.notificationCreate.mockResolvedValue({ id: "n-1" });
  h.fanOut.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/cron/check-overdue-actions 的离线扇出", () => {
  it("只对有指派人且首次通知的行动项扇出一次，参数指向该收件人", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    expect(h.fanOut).toHaveBeenCalledTimes(1);
    expect(h.fanOut).toHaveBeenCalledWith({
      userId: "u-assignee",
      workspaceId: "w-1",
      type: "action_overdue",
      entityId: "ai-1",
      // 邮件正文给人看：用真实任务标题，而不是站内记录里那个 i18n key
      entityTitle: "逾期行动项：把发布说明写完",
      bodySnippet: expect.any(String),
    });
  });

  it("扇出排在事务回调结束之后（SMTP IO 不进 RLS 事务）", async () => {
    h.fanOut.mockImplementation(async () => {
      h.log.push("fanOut");
    });

    await GET(makeReq());

    const fanAt = h.log.indexOf("fanOut");
    expect(fanAt).toBeGreaterThan(-1);
    expect(fanAt).toBeGreaterThan(h.log.indexOf("tx:end"));
    expect(h.log.indexOf("tx:end")).toBeLessThan(h.log.length - 1); // fanOut 是最后一个
  });

  it("响应形状不因内部扇出目标而改变（契约只认三个计数）", async () => {
    const res = await GET(makeReq());
    const body = await res.json();

    expect(Object.keys(body.data).sort()).toEqual(["checked", "notified", "skipped"]);
    expect(body.data).toEqual({ checked: 3, notified: 1, skipped: 2 });
  });

  it("站内记录仍由 cron 自己落，且没有多落一条", async () => {
    await GET(makeReq());

    expect(h.notificationCreate).toHaveBeenCalledTimes(1);
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({
      userId: "u-assignee",
      type: "action_overdue",
      entityId: "ai-1",
    });
  });
});
