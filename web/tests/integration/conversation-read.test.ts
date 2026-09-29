import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * 会话标记已读 · POST /v1/workspaces/{wid}/conversations/{cid}/read
 *
 * 为什么单独有这张文件：该端点此前**零测试覆盖**，而它的实现直接
 * `await req.json()`——唯一字段 lastReadAt 是 optional，语义上允许空 body，
 * 但线上调用方 components/im/useIM.ts:203 的 POST 不带 body，于是每次标记已读
 * 都抛 SyntaxError 并落进兜底 catch 返回 500。一次生产 E2E 跑动里实测到 467 次
 * `[POST conversation read] error: SyntaxError: Unexpected end of JSON input`。
 * 这里把"空 body 必须可用"与"非法 body 必须 400 而非 500"钉住。
 */

interface Ctx {
  accessToken: string;
  wid: string;
  cid: string;
}

let ctx: Ctx;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "convread-owner", workspaceName: "已读测试工作区" });
  const task = await createTask(owner.accessToken, owner.workspace.id, {
    title: "已读端点目标任务",
  });
  expect(task.status, `创建任务应成功，实际 ${task.status}`).toBe(201);
  const taskId = (task.body as { data?: { id?: string } })?.data?.id ?? "";
  expect(taskId).toBeTruthy();

  const conv = await fetch(
    `${BASE}/workspaces/${owner.workspace.id}/tasks/${taskId}/conversation`,
    {
      method: "POST",
      headers: authHeader(owner.accessToken),
    },
  );
  expect([200, 201], `创建/获取会话应成功，实际 ${conv.status}`).toContain(conv.status);
  const convJson = (await conv.json()) as { data?: { id?: string } };
  const cid = convJson?.data?.id ?? "";
  expect(cid, "响应应含会话 id").toBeTruthy();

  ctx = { accessToken: owner.accessToken, wid: owner.workspace.id, cid };
});

const readUrl = () => `${BASE}/workspaces/${ctx.wid}/conversations/${ctx.cid}/read`;

describe("标记已读端点的 body 处理", () => {
  it("无 body 的 POST 应 200（线上调用方就是这样发的）", async () => {
    const res = await fetch(readUrl(), { method: "POST", headers: authHeader(ctx.accessToken) });
    expect(res.status, "空 body 不该被当成非法请求").toBe(200);
  });

  it("显式空对象 {} 应 200", async () => {
    const res = await fetch(readUrl(), {
      method: "POST",
      headers: { ...authHeader(ctx.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("带未来的 lastReadAt 应 200 并回写该时间", async () => {
    const stamp = "2099-01-02T03:04:05.000Z";
    const res = await fetch(readUrl(), {
      method: "POST",
      headers: { ...authHeader(ctx.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ lastReadAt: stamp }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { lastReadAt?: string } };
    expect(new Date(json?.data?.lastReadAt ?? "").getTime(), "更新的游标应被写入").toBe(
      new Date(stamp).getTime(),
    );
  });

  it("已读游标只前进不倒退：传入更早时间返回现有值", async () => {
    // 端点的防回退语义（route.ts:74-84 取 max）：游标只前进。
    // 前置值取 2999 年——比本文件其它用例写过的任何游标都大，
    // 因此不依赖用例执行顺序（早前用 2098 时被上一条的 2099 盖住，断言假红）。
    const future = "2999-06-06T06:06:06.000Z";
    await fetch(readUrl(), {
      method: "POST",
      headers: { ...authHeader(ctx.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ lastReadAt: future }),
    });

    const res = await fetch(readUrl(), {
      method: "POST",
      headers: { ...authHeader(ctx.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ lastReadAt: "2020-05-05T00:00:00.000Z" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data?: { lastReadAt?: string } };
    expect(new Date(json?.data?.lastReadAt ?? "").getTime(), "游标不该被旧时间拉回").toBe(
      new Date(future).getTime(),
    );
  });

  it("非法 JSON 应 400 而不是 500", async () => {
    const res = await fetch(readUrl(), {
      method: "POST",
      headers: { ...authHeader(ctx.accessToken), "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
  });

  it("未认证访问返回 401", async () => {
    const res = await fetch(readUrl(), { method: "POST" });
    expect([401, 403]).toContain(res.status);
  });
});
