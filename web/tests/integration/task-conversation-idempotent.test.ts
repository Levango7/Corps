import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * POST /tasks/{id}/conversation 的"获取或创建"必须是原子的。
 *
 * 起因（2026-10-05 生产 E2E 的 trace.network 一手证据）：一次任务详情页打开
 * 就发出 3 个该 POST，且 **3 个都返回 201 且 conversation id 各不相同**——
 * 路由写的是 findFirst→没有就 create，两个并发事务在 READ COMMITTED 下互相
 * 看不见对方未提交的行，于是都走 create 分支。隔离库里 78 个任务带着 >1 条会话。
 *
 * 后果不只是脏数据：面板显示的会话与消息真正写入的会话可能不是同一条，
 * 用户"发出去的消息自己看不到"（im-upgrade.spec.ts 的时间戳用例因此在高负载下红，
 * DOM 快照显示空状态、而 trace 里那条 POST /messages 是 201）。
 *
 * 修法是事务级 advisory lock 按 taskId 串行化（pg_advisory_xact_lock 随事务结束释放）。
 * 这里用 Promise.all 并发打，断言"全部返回同一个 id"——串行化前必然不同。
 */

interface ConvResp {
  status: number;
  id: string;
}

let owner: { accessToken: string; wid: string };
let taskId: string;

beforeAll(async () => {
  const u = await registerUser({ prefix: "taskconv-owner", workspaceName: "任务会话幂等工作区" });
  owner = { accessToken: u.accessToken, wid: u.workspace.id };
  const task = await createTask(owner.accessToken, owner.wid, { title: "会话幂等载体任务" });
  expect(task.status, "创建任务应成功").toBe(201);
  taskId = (task.body as { data?: { id?: string } })?.data?.id ?? "";
  expect(taskId, "应能取到任务 id").not.toBe("");
});

async function postConversation(accessToken: string): Promise<ConvResp> {
  const res = await fetch(`${BASE}/workspaces/${owner.wid}/tasks/${taskId}/conversation`, {
    method: "POST",
    headers: authHeader(accessToken),
  });
  const body = (await res.json()) as { data?: { id?: string } };
  return { status: res.status, id: body?.data?.id ?? "" };
}

describe("POST /workspaces/{wid}/tasks/{id}/conversation", () => {
  it("并发 5 次也只得到一条会话（此前每次都新建）", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postConversation(owner.accessToken)),
    );

    for (const r of results) {
      expect([200, 201], `获取/创建会话应成功，实际 ${r.status}`).toContain(r.status);
      expect(r.id, "响应应带会话 id").not.toBe("");
    }
    // 核心断言：并发请求不得各自新建一条。串行化缺失时这里是 5 个不同 id。
    expect(new Set(results.map((r) => r.id)).size, "同一任务并发请求必须复用同一条会话").toBe(1);

    // 201 至多一次：第一次是新建，其余应是"已存在"（200）
    const created = results.filter((r) => r.status === 201).length;
    expect(created, "只允许第一个请求真的新建").toBe(1);
  });

  it("重复请求返回的会话成员不重复累积", async () => {
    const first = await postConversation(owner.accessToken);
    const again = await postConversation(owner.accessToken);
    expect(again.id, "第二次应拿回同一条会话").toBe(first.id);

    const detail = await fetch(`${BASE}/workspaces/${owner.wid}/conversations/${first.id}`, {
      headers: authHeader(owner.accessToken),
    });
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as { data?: { members?: unknown[] } };
    const members = Array.isArray(body?.data?.members) ? body.data.members : [];
    // 该端点的成员数组键形如 { members }（与会话列表的 { items } 不同），这里只断言
    // "自己不会重复出现"，不替服务端承诺键名。
    const ids = members.map((m) => (m as { userId?: string }).userId);
    expect(new Set(ids).size, "同一用户不应在成员里出现多次").toBe(ids.length);
  });
});
