import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 审批 API 集成测试（/workspaces/{wid}/approvals 全域）
 *
 * 覆盖：
 * 1. 模板 CRUD — POST（nodes 最小 1）/ GET 列表分页信封（items/page/limit/pageSize/total/hasMore）/ GET 详情 / PATCH / DELETE 停用
 * 2. 实例提交与详情 — POST（title/content/nodes，approverUserId 指定审批人）/ GET 列表 status 过滤 / GET 详情（templateName、currentApproverIds）
 * 3. 审批动作 — approve（节点审批人 200 / 非审批人 403 / 重复 409）、reject（status=rejected）
 * 4. 评论 — comment 1-1000，空 400
 * 5. 撤回 — 申请人 withdraw pending 实例
 * 6. 委托 CRUD — delegates POST/GET/PATCH/DELETE
 * 7. 统计 — stats 的 byStatus/byPriority/byTemplate/pendingMine
 * 8. 跨工作区隔离 — B 的 token 读 A 的实例 403
 *
 * 契约：api/openapi.yaml 已声明该域（2026-10-28 契约批 #204，16 路径 24 方法），
 * 本文件是其行为侧的钉子。注意：approvals 域使用 code=200 新信封（非 forms 域的 code=0 legacy）。
 */

let ownerToken: string;
let otherToken: string;
let otherUserId: string;
let wid: string;
let templateId: string;

const auth = (t: string) => ({ ...authHeader(t), "Content-Type": "application/json" });

async function createTemplate(token: string, approverUserId: string) {
  return fetch(`${BASE}/workspaces/${wid}/approvals/templates`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      name: "测试审批模板",
      nodes: [{ name: "主管审批", order: 0, approverUserId, mode: "sequential" }],
    }),
  });
}

async function createInstance(token: string, tid: string, title: string, approverUserId: string) {
  return fetch(`${BASE}/workspaces/${wid}/approvals/instances`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      templateId: tid,
      title,
      content: { reason: "测试事由" },
      nodes: [{ name: "主管审批", order: 0, approverUserId, mode: "sequential" }],
    }),
  });
}

beforeAll(async () => {
  const owner = await registerUser({
    prefix: "approvals-owner",
    workspaceName: "审批测试工作区",
  });
  ownerToken = owner.accessToken;
  wid = owner.workspace.id;

  const other = await registerUser({ prefix: "approvals-other" });
  otherToken = other.accessToken;
  otherUserId = other.user.id;

  const res = await createTemplate(ownerToken, otherUserId);
  const json = await res.json();
  templateId = json.data.id;
});

describe("模板 CRUD", () => {
  it("POST /templates 创建成功（nodes 最小 1）", async () => {
    const res = await createTemplate(ownerToken, otherUserId);
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.name).toBe("测试审批模板");
    expect(json.data.nodes).toHaveLength(1);
    expect(json.data.nodes[0].approverUserId).toBe(otherUserId);
  });

  it("POST /templates nodes 为空数组返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/templates`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ name: "空节点模板", nodes: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /templates 列表返回分页信封（含 pageSize 兼容键）", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/templates?page=1&limit=10`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.items.length).toBeGreaterThanOrEqual(1);
    expect(json.data.page).toBe(1);
    expect(json.data.limit).toBe(10);
    expect(json.data.pageSize).toBe(10);
    expect(json.data.total).toBeGreaterThanOrEqual(1);
    expect(typeof json.data.hasMore).toBe("boolean");
  });

  it("GET /templates/{tid} 返回模板详情", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/templates/${templateId}`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.id).toBe(templateId);
  });

  it("PATCH /templates/{tid} 更新名称", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/templates/${templateId}`, {
      method: "PATCH",
      headers: auth(ownerToken),
      body: JSON.stringify({ name: "改名后的模板" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.name).toBe("改名后的模板");
  });
});

describe("实例提交与详情", () => {
  it("POST /instances 提交成功（nodes 指定 other 为审批人）", async () => {
    const res = await createInstance(ownerToken, templateId, "报销申请", otherUserId);
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.code).toBe(201);
    expect(json.data.title).toBe("报销申请");
    expect(json.data.status).toBe("pending");
  });

  it("POST /instances 缺 title 返回 400", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ templateId, content: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /instances?status=pending 含刚提交的实例", async () => {
    const created = await createInstance(ownerToken, templateId, "待审实例", otherUserId);
    const createdJson = await created.json();

    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances?status=pending`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    const ids = json.data.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(createdJson.data.id);
  });

  it("GET /instances/{aid} 详情含 templateName 与 currentApproverIds", async () => {
    const created = await createInstance(ownerToken, templateId, "详情实例", otherUserId);
    const createdJson = await created.json();
    const aid = createdJson.data.id;

    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.templateName).toBeTruthy();
    expect(json.data.currentApproverIds).toContain(otherUserId);
  });

  it("跨工作区隔离：B 的 token 读 A 的实例 403", async () => {
    const created = await createInstance(ownerToken, templateId, "隔离实例", otherUserId);
    const aid = (await created.json()).data.id;

    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}`, {
      headers: auth(otherToken),
    });
    expect(res.status).toBe(403);
  });
});

describe("审批动作（approve / reject / comment / withdraw）", () => {
  it("节点审批人 approve 成功，实例流转；重复 approve 返回 409", async () => {
    const created = await createInstance(ownerToken, templateId, "待批实例", otherUserId);
    const aid = (await created.json()).data.id;

    const approveRes = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/approve`, {
      method: "POST",
      headers: auth(otherToken),
      body: JSON.stringify({ comment: "同意" }),
    });
    const approveJson = await approveRes.json();
    expect(approveRes.status).toBe(200);
    expect(approveJson.data.status).toBe("approved");

    const again = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/approve`, {
      method: "POST",
      headers: auth(otherToken),
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(409);
  });

  it("非审批人 approve 返回 403", async () => {
    const created = await createInstance(ownerToken, templateId, "他人代批实例", otherUserId);
    const aid = (await created.json()).data.id;

    // owner 不在节点审批人里（审批人是 other）
    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/approve`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("reject 后实例 status=rejected", async () => {
    const created = await createInstance(ownerToken, templateId, "驳回实例", otherUserId);
    const aid = (await created.json()).data.id;

    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/reject`, {
      method: "POST",
      headers: auth(otherToken),
      body: JSON.stringify({ comment: "不符合规定" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.status).toBe("rejected");
  });

  it("comment 空内容返回 400，合法内容 200", async () => {
    const created = await createInstance(ownerToken, templateId, "评论实例", otherUserId);
    const aid = (await created.json()).data.id;

    const bad = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/comment`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ comment: "" }),
    });
    expect(bad.status).toBe(400);

    const ok = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/comment`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ comment: "请补充明细" }),
    });
    expect(ok.status).toBe(200);
  });

  it("申请人 withdraw pending 实例成功", async () => {
    const created = await createInstance(ownerToken, templateId, "撤回实例", otherUserId);
    const aid = (await created.json()).data.id;

    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/withdraw`, {
      method: "POST",
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.status).toBe("withdrawn");
  });
});

describe("委托 CRUD", () => {
  it("POST /delegates 创建 → GET 列表 → PATCH → DELETE", async () => {
    const create = await fetch(`${BASE}/workspaces/${wid}/approvals/delegates`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({
        delegateToId: otherUserId,
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + 86400_000).toISOString(),
        reason: "休假委托",
      }),
    });
    const createJson = await create.json();
    expect(create.status).toBe(201);
    expect(createJson.data.delegateTo.id).toBe(otherUserId);
    const did = createJson.data.id;

    const list = await fetch(`${BASE}/workspaces/${wid}/approvals/delegates?active=1`, {
      headers: auth(ownerToken),
    });
    const listJson = await list.json();
    expect(list.status).toBe(200);
    expect(listJson.data.items.some((d: { id: string }) => d.id === did)).toBe(true);

    const patch = await fetch(`${BASE}/workspaces/${wid}/approvals/delegates/${did}`, {
      method: "PATCH",
      headers: auth(ownerToken),
      body: JSON.stringify({ reason: "出差委托" }),
    });
    expect(patch.status).toBe(200);

    const del = await fetch(`${BASE}/workspaces/${wid}/approvals/delegates/${did}`, {
      method: "DELETE",
      headers: auth(ownerToken),
    });
    expect(del.status).toBe(200);
  });
});

describe("统计与操作端点", () => {
  it("GET /stats 返回 byStatus/byPriority/byTemplate/pendingMine", async () => {
    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/stats`, {
      headers: auth(ownerToken),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.total).toBeGreaterThanOrEqual(0);
    expect(json.data.byStatus).toBeTruthy();
    expect(json.data.byPriority).toBeTruthy();
    expect(json.data.byTemplate).toBeTruthy();
    expect(typeof json.data.pendingMine).toBe("number");
  });

  it("POST /instances/{aid}/cc 添加抄送人", async () => {
    const created = await createInstance(ownerToken, templateId, "抄送实例", otherUserId);
    const aid = (await created.json()).data.id;

    const res = await fetch(`${BASE}/workspaces/${wid}/approvals/instances/${aid}/cc`, {
      method: "POST",
      headers: auth(ownerToken),
      body: JSON.stringify({ ccUserIds: [otherUserId] }),
    });
    expect(res.status).toBe(200);
  });
});
