import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * 会话列表与未读计数端点的回归锚点
 *
 * 起因：两者的未读数聚合走 `WHERE m.conversation_id IN (${Prisma.join(ids)})`，
 * Prisma 把 JS 数组绑成 text，与 uuid 列比较在 PostgreSQL 直接报
 * `42883 operator does not exist: uuid = text`，端点返回 500。
 * 一次生产 E2E 里 `[GET conversations] error` 与 `[GET unread-count] error` 各出现多次，
 * 表现为任务详情页 ChatPanel 渲染不出来（im-upgrade.spec.ts 的头两条用例因此红）。
 * 改法是 `= ANY(${ids}::uuid[])`（保留 uuid 语义与索引可用性）。
 *
 * 这两个端点此前**没有任何集成覆盖**，所以缺陷能活到生产：空列表走不到那段 SQL，
 * 只有"至少存在一个会话"时才触发——用例因此刻意先建会话再查。
 */

interface Ctx {
  accessToken: string;
  wid: string;
  /** 真实会话 id（成员端点用例需要；从列表端点取，避免依赖 POST 响应形状） */
  conversationId: string;
}

let ctx: Ctx;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "convlist-owner", workspaceName: "会话列表工作区" });
  ctx = { accessToken: owner.accessToken, wid: owner.workspace.id, conversationId: "" };

  // 两个任务 → 两个会话，保证 conversationIds 非空且长度 > 1
  for (const label of ["A", "B"]) {
    const task = await createTask(ctx.accessToken, ctx.wid, { title: `会话载体任务-${label}` });
    expect(task.status, `创建任务应成功，实际 ${task.status}`).toBe(201);
    const taskId = (task.body as { data?: { id?: string } })?.data?.id ?? "";
    const conv = await fetch(`${BASE}/workspaces/${ctx.wid}/tasks/${taskId}/conversation`, {
      method: "POST",
      headers: authHeader(ctx.accessToken),
    });
    expect([200, 201], `获取/创建会话应成功，实际 ${conv.status}`).toContain(conv.status);
  }

  const list = await fetch(`${BASE}/workspaces/${ctx.wid}/conversations`, {
    headers: authHeader(ctx.accessToken),
  });
  const listBody = (await list.json()) as { data?: { items?: Array<{ id?: string }> } };
  ctx.conversationId = listBody?.data?.items?.[0]?.id ?? "";
  expect(ctx.conversationId, "至少应能取到一个会话 id").not.toBe("");
});

describe("GET /workspaces/{wid}/conversations", () => {
  it("存在会话时返回 200 且 items 是数组（此前是 500：uuid = text）", async () => {
    const res = await fetch(`${BASE}/workspaces/${ctx.wid}/conversations`, {
      headers: authHeader(ctx.accessToken),
    });
    expect(res.status, "未修 cast 前这里是 500").toBe(200);
    const json = (await res.json()) as {
      data?: { items?: unknown[]; hasMore?: boolean };
    };
    expect(Array.isArray(json?.data?.items)).toBe(true);
    expect(json?.data?.items?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(typeof json?.data?.hasMore).toBe("boolean");
  });

  /**
   * 分页上限的边界（两侧都钉住）。
   *
   * 为什么单拎出来测：这是「500 resources」那轮排查里唯一**没有任何用例覆盖**的
   * 参数形态。同批三个端点中 `notifications?count=true` 有集成用例，而 `limit`
   * 的 schema 上限虽然写在 route.ts:25 的 `.max(100)`，但从来没有人真的用 100
   * 请求过。上限值恰好是合法/非法行为翻转的那一个点，也正是最容易被
   * 「把 max 改大一点试试」改坏、却不会被任何测试发现的那一个点。
   *
   * 两条断言的侧重点不同：合法侧要证明**上限值本身能用**且分页不外溢；
   * 越界侧要证明**回的是 400 不是 500**——越界参数是客户端错误，回 5xx 会让
   * 前端把参数问题误报成服务不可用，那正是当初排查 500 时最误导人的形态。
   */
  it("limit=100（schema 上限）返回 200，且单页不超过 100 条", async () => {
    const res = await fetch(`${BASE}/workspaces/${ctx.wid}/conversations?limit=100`, {
      headers: authHeader(ctx.accessToken),
    });
    expect(res.status, "上限值本身必须是合法输入").toBe(200);
    const json = (await res.json()) as { data?: { items?: unknown[] } };
    expect(Array.isArray(json?.data?.items)).toBe(true);
    expect(json?.data?.items?.length ?? 0).toBeLessThanOrEqual(100);
  });

  it("limit 越界（101 / 0）返回 400 而不是 500", async () => {
    for (const bad of ["101", "0"]) {
      const res = await fetch(`${BASE}/workspaces/${ctx.wid}/conversations?limit=${bad}`, {
        headers: authHeader(ctx.accessToken),
      });
      expect(res.status, `limit=${bad} 应被判为客户端错误 400`).toBe(400);
      const json = (await res.json()) as { code?: number };
      expect(json?.code).toBe(400);
    }
  });
});

describe("GET /workspaces/{wid}/conversations/unread-count", () => {
  it("返回 200 且带 totalUnread 与 byConversation", async () => {
    const res = await fetch(`${BASE}/workspaces/${ctx.wid}/conversations/unread-count`, {
      headers: authHeader(ctx.accessToken),
    });
    expect(res.status, "未修 cast 前这里是 500").toBe(200);
    const json = (await res.json()) as {
      data?: { totalUnread?: number; byConversation?: unknown[] };
    };
    expect(typeof json?.data?.totalUnread).toBe("number");
    expect(Array.isArray(json?.data?.byConversation)).toBe(true);
  });

  it("没有任何会话的用户也应返回 200（空 id 列表不得让查询崩）", async () => {
    const lonely = await registerUser({ prefix: "convlist-lonely", workspaceName: "无会话工作区" });
    const res = await fetch(
      `${BASE}/workspaces/${lonely.workspace.id}/conversations/unread-count`,
      {
        headers: authHeader(lonely.accessToken),
      },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { totalUnread?: number } };
    expect(json?.data?.totalUnread).toBe(0);
  });
});

describe("GET /workspaces/{wid}/conversations/{cid}/members", () => {
  it("返回分页信封：成员数组在 data.items，且不存在 members 键", async () => {
    const res = await fetch(
      `${BASE}/workspaces/${ctx.wid}/conversations/${ctx.conversationId}/members`,
      { headers: authHeader(ctx.accessToken) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data?: { items?: Array<{ userId?: string }>; total?: number; hasMore?: boolean };
    };
    // 契约锚点：客户端必须读 items。曾按 data.members 取键，被 Array.isArray 兜底成 []
    // → 会话成员列表恒为空且不报错（静默失效，比崩溃更难发现）
    expect(Array.isArray(json?.data?.items)).toBe(true);
    expect(json?.data?.items?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect((json?.data as Record<string, unknown>)?.members).toBeUndefined();
    expect(typeof json?.data?.total).toBe("number");
    expect(typeof json?.data?.hasMore).toBe("boolean");
  });
});
