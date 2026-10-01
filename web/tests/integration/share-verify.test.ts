import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, createTask } from "../helpers";

/**
 * 分享验证路由 × RLS 集成测试（ADR-010 G4）
 *
 * 与姊妹用例的分工：db/rls-smoke.sh 在【数据库引擎层】以 corps_app 直连断言
 * share_access_logs 策略（自可见 1 / 跨租户 0 / 孤儿行 0 / 裸连接 0）；本用例在
 * 【应用层】验证三条真实写入路径在普通与 NOBYPASSRLS 加固两种连接模式下行为一致：
 *  1. 公开文档验证 /api/documents/share/[token]/verify —— 只有 public_token GUC，
 *     写日志前必须先 setTxGuc 注入文档行上的 workspace_id；漏掉注入会在加固模式下
 *     被 INSERT 的 WITH CHECK 拒绝而 500，这是本用例的主验收点；
 *  2. 工作任务验证 /workspaces/{wid}/tasks/{id}/share/verify —— runWithWorkspace 上下文；
 *  3. 工作文档验证 /workspaces/{wid}/documents/{id}/share/verify —— 同上。
 * 并借日志读取路由（runWithWorkspace + SELECT 策略）把落库行读回来，验证 workspaceId
 * 已真实落列且对本租户可读。
 */

const PUB = BASE.replace("/api/v1", "");

let token: string;
let wid: string;

beforeAll(async () => {
  const owner = await registerUser({ prefix: "share-verify", workspaceName: "分享验证工作区" });
  token = owner.accessToken;
  wid = owner.workspace.id;
  expect(token.length).toBeGreaterThan(0);
});

async function createDoc(title: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/workspaces/${wid}/documents`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, ...extra }),
  });
  return { res, json: await res.json() };
}

async function publishAndShare(docId: string): Promise<string> {
  const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}`, {
    method: "PATCH",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ publish: true, shareToken: "rotate" }),
  });
  const json = await res.json();
  expect(json.data.shareToken).toBeTruthy();
  return json.data.shareToken as string;
}

async function readLogs(docId: string) {
  const res = await fetch(`${BASE}/workspaces/${wid}/documents/${docId}/share/logs`, {
    headers: authHeader(token),
  });
  return { res, json: await res.json() };
}

describe("公开文档分享验证（setTxGuc 写入路径）", () => {
  it("无密码分享：POST verify 放行并返回已发布正文", async () => {
    const { json: created } = await createDoc("公开验证文档", { markdown: "## 对外正文" });
    const shareTok = await publishAndShare(created.data.id);

    const res = await fetch(`${PUB}/api/documents/share/${shareTok}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "unused" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.id).toBe(created.data.id);
    expect(json.data.markdown).toBe("## 对外正文");
  });

  it("公开验证写入的日志带 workspaceId，且读取路由能读回", async () => {
    const { json: created } = await createDoc("公开验证日志文档", { markdown: "## 正文" });
    const shareTok = await publishAndShare(created.data.id);

    const verify = await fetch(`${PUB}/api/documents/share/${shareTok}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "unused" }),
    });
    expect(verify.status).toBe(200);

    const { res, json } = await readLogs(created.data.id);
    expect(res.status).toBe(200);
    expect(json.data.total).toBe(1);
    expect(json.data.items[0].entityType).toBe("document");
    expect(json.data.items[0].entityId).toBe(created.data.id);
    expect(json.data.items[0].workspaceId).toBe(wid);
  });
});

describe("工作区分享验证（runWithWorkspace 写入路径）", () => {
  it("任务 share/verify 返回 200（加固模式下证明日志插入通过 RLS）", async () => {
    const { body } = await createTask(token, wid, { title: "分享验证任务" });
    const taskId = body.data!.id;
    const rot = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}`, {
      method: "PATCH",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ shareToken: "rotate" }),
    });
    const rotJson = await rot.json();
    expect(rotJson.data.shareToken).toBeTruthy();

    const res = await fetch(`${BASE}/workspaces/${wid}/tasks/${taskId}/share/verify`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ password: "unused" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.id).toBe(taskId);
  });

  it("文档 share/verify 返回 200 且日志落库（带 workspaceId）", async () => {
    const { json: created } = await createDoc("工作区验证文档", { markdown: "## 正文" });
    await publishAndShare(created.data.id);

    const res = await fetch(`${BASE}/workspaces/${wid}/documents/${created.data.id}/share/verify`, {
      method: "POST",
      headers: { ...authHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ password: "unused" }),
    });
    expect(res.status).toBe(200);

    const { json } = await readLogs(created.data.id);
    expect(json.data.total).toBe(1);
    expect(json.data.items[0].workspaceId).toBe(wid);
  });
});
