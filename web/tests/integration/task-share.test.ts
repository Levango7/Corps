import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 任务公开分享集成测试（v0.4.0 队列第 6 项）
 *
 * 覆盖：
 * 1. PATCH shareToken="rotate" 生成 token（返回体含 shareToken）
 * 2. 公开 API（无需登录）读取任务只读视图（标题/状态/子任务）
 * 3. 脱敏：公开视图不含 assignee.email / creator / 评论正文等
 * 4. PATCH shareToken=null 撤销后公开 API 404
 * 5. 无 token 的任务公开 API 404
 */

let token: string;
let wid: string;
let taskId: string;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "taskshare", workspaceName: "任务分享工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;

  // 建一个带子任务的父任务
  const created = await fetch(`${BASE}/workspaces/${wid}/tasks`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title: "分享的父任务", description: "给外部看的说明" }),
  });
  const cj = await created.json();
  taskId = cj.data.id;
  await fetch(`${BASE}/workspaces/${wid}/tasks`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title: "子任务 X", parentId: taskId }),
  });
});

describe("任务公开分享", () => {
  let shareToken: string;

  it('PATCH shareToken="rotate" 生成分享 token', async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken: "rotate" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.shareToken).toBeTruthy();
    expect(json.data.shareToken).not.toBe("rotate");
    shareToken = json.data.shareToken;
  });

  it("公开 API 无需登录读取只读视图（含子任务）", async () => {
    const pub = await fetch(`${BASE.replace("/api/v1", "")}/api/tasks/share/${shareToken}`);
    const json = await pub.json();
    expect(pub.status).toBe(200);
    expect(json.data.title).toBe("分享的父任务");
    expect(json.data.children).toHaveLength(1);
    expect(json.data.children[0].title).toBe("子任务 X");
    // 不应包含敏感字段
    expect(json.data.assignee?.email).toBeUndefined();
    expect(json.data.creator).toBeUndefined();
    expect(json.data.comments).toBeUndefined();
  });

  it("PATCH shareToken=null 撤销后公开 API 404", async () => {
    const off = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken: null }),
    });
    const offJson = await off.json();
    expect(off.status).toBe(200);
    expect(offJson.data.shareToken).toBeNull();

    const pub = await fetch(`${BASE.replace("/api/v1", "")}/api/tasks/share/${shareToken}`);
    expect(pub.status).toBe(404);
  });

  it("无分享 token 的任务公开 API 404", async () => {
    const pub = await fetch(`${BASE.replace("/api/v1", "")}/api/tasks/share/nonexistent-token-xyz`);
    expect(pub.status).toBe(404);
  });

  it("跨工作区：他人不能通过 workspace API 读他人任务（401 非成员）", async () => {
    const other = await registerUser({ prefix: "taskshare-other" });
    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      headers: authHeader(other.accessToken),
    });
    expect(res.status).toBe(401);
  });
});
