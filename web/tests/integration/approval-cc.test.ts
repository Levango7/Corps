import { describe, it, expect, beforeAll } from "vitest";
import { BASE, registerUser, authHeader, cookieHeader, inviteMember } from "../helpers";

/**
 * 审批实例抄送列表读取端集成测试（GET /workspaces/{wid}/approvals/instances/{aid}/cc）
 *
 * 起因：该路由此前只有 POST，而 `components/approval/ApprovalDetail.tsx` 用无 method 的
 * `api<CcUser[]>()` 去读 ⇒ 恒 405，又被调用点 `catch {}` / `.catch(() => [])` 双双吞掉，
 * 表现成"这单没有抄送人"的**静默错数据**。本套件把这条读路径钉住，并特意留下 405 的反向断言。
 *
 * 覆盖：
 * 1. 未登录 → 401
 * 2. 令牌绑定到别的工作区（wid 守卫层）→ 401
 * 3. 令牌已换绑到**目标**工作区、但调用者不是该工作区成员（成员校验层）→ 401
 *    —— 这条才是真跨租户判据：实测 `/auth/refresh` 会为任意 workspaceId 发票据
 *    （200 + access_token），所以去掉 getWorkspaceContext 里的成员查询时，
 *    第 2 条仍然 401、只有第 3 条会退化。两条都留着。
 * 4. 抄送 2 人后 GET → 200，数组含 2 条，字段齐（id/userId/user.name/read/nodeIndex）
 * 5. 无抄送记录时 → 200 + 空数组（与"真的没有抄送"同形，但**不是** 405/404）
 * 6. 实例不存在 → 404
 * 7. viewer（只读成员）也能读 —— 读路径不应被角色门禁拦下
 */

interface CcRow {
  id: string;
  userId: string;
  user?: { id: string; name?: string | null; email?: string | null } | null;
  read?: boolean;
  nodeIndex?: number;
}

let ownerToken: string;
let wid: string;
let ccUserIdA: string;
let ccUserIdB: string;
let instanceId: string;
let emptyInstanceId: string;
let outsiderToken: string;
let outsiderInstanceId: string;
let outsiderCookies: string[];
let forgedToken: string | undefined;
let viewerToken: string;

async function createInstance(token: string, workspaceId: string, title: string) {
  const res = await fetch(`${BASE}/workspaces/${workspaceId}/approvals/instances`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content: { reason: "抄送读取测试" },
      nodes: [{ name: "一级审批", order: 0 }],
    }),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as { data?: { id: string } } | null,
  };
}

async function addCc(token: string, workspaceId: string, aid: string, userIds: string[]) {
  const res = await fetch(`${BASE}/workspaces/${workspaceId}/approvals/instances/${aid}/cc`, {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ccUserIds: userIds }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function readCc(token: string | null, workspaceId: string, aid: string) {
  const headers = token ? authHeader(token) : {};
  const res = await fetch(`${BASE}/workspaces/${workspaceId}/approvals/instances/${aid}/cc`, {
    headers,
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as { code: number; data: unknown } | null,
  };
}

/**
 * 用 session cookie 换一张**绑定到指定工作区**的 access token。
 *
 * 为什么必需：register 返回的 access_token 绑的是调用者自己的默认工作区，而
 * `getWorkspaceContext` 的 wid 守卫（`payload.wid !== wid` 直接判 null）会在查成员
 * **之前**短路成 401。所以要测"某工作区里的 viewer 角色"或"非成员越权"，
 * 必须先换一张目标工作区的令牌——与 rbac.test.ts 同款做法。
 */
async function wsBoundToken(cookies: string[], workspaceId: string): Promise<string | undefined> {
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { ...cookieHeader(cookies), "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return setCookie
    .find((c) => c.startsWith("access_token="))
    ?.split("=")[1]
    ?.split(";")[0];
}

beforeAll(async () => {
  const owner = await registerUser({ prefix: "approval-cc-owner", workspaceName: "抄送读取测试" });
  ownerToken = owner.accessToken;
  wid = owner.workspace.id;

  const ccA = await registerUser({ prefix: "approval-cc-a" });
  const ccB = await registerUser({ prefix: "approval-cc-b" });
  ccUserIdA = ccA.user.id;
  ccUserIdB = ccB.user.id;
  // 抄送对象必须是本工作区成员（POST 侧会校验），先邀请进来
  expect((await inviteMember(ownerToken, wid, ccA.user.email)).status).toBe(201);
  expect((await inviteMember(ownerToken, wid, ccB.user.email)).status).toBe(201);

  const created = await createInstance(ownerToken, wid, "抄送读取用申请");
  expect(created.status).toBe(201);
  instanceId = created.body!.data!.id;

  const emptyCreated = await createInstance(ownerToken, wid, "无抄送用申请");
  expect(emptyCreated.status).toBe(201);
  emptyInstanceId = emptyCreated.body!.data!.id;

  // 另一个租户：验证跨租户读不到
  const outsider = await registerUser({
    prefix: "approval-cc-outsider",
    workspaceName: "抄送读取测试-外租户",
  });
  outsiderToken = outsider.accessToken;
  outsiderCookies = outsider.cookies;
  const outsiderCreated = await createInstance(
    outsider.accessToken,
    outsider.workspace.id,
    "外租户申请",
  );
  expect(outsiderCreated.status).toBe(201);
  outsiderInstanceId = outsiderCreated.body!.data!.id;

  // 越权令牌：outsider 并非 wid 的成员，但 /auth/refresh 实测照样为 wid 发票据。
  // 拿这张"wid 合法、身份不合法"的令牌读取，判定必须落在成员校验上（见用例 3）。
  forgedToken = await wsBoundToken(outsiderCookies, wid);
  expect(forgedToken).toBeTruthy();

  // viewer 只读成员
  const viewer = await registerUser({ prefix: "approval-cc-viewer" });
  expect((await inviteMember(ownerToken, wid, viewer.user.email)).status).toBe(201);
  const demote = await fetch(`${BASE}/workspaces/${wid}/members/${viewer.user.id}`, {
    method: "PATCH",
    headers: { ...authHeader(ownerToken), "Content-Type": "application/json" },
    body: JSON.stringify({ role: "viewer" }),
  });
  expect(demote.status).toBe(200);
  viewerToken = (await wsBoundToken(viewer.cookies, wid)) ?? "";
  expect(viewerToken).toBeTruthy();
});

describe("审批实例抄送列表读取（GET .../cc）", () => {
  it("未登录读取返回 401", async () => {
    const { status } = await readCc(null, wid, instanceId);
    expect(status).toBe(401);
  });

  it("令牌绑在别的工作区时读不到（wid 守卫层）", async () => {
    // outsider 的 register 令牌绑它自己的工作区 ⇒ URL wid 与 payload.wid 不符
    const { status } = await readCc(outsiderToken, wid, instanceId);
    expect(status).toBe(401);
  });

  it("令牌已换绑到本工作区但调用者不是成员时读不到（成员校验层 = 真跨租户判据）", async () => {
    // forgedToken 的 payload.wid === wid，wid 守卫放行；唯一还挡着它的是成员查询。
    // 若哪天 getWorkspaceContext 少了那次 findFirst，只有本用例会展红。
    expect(forgedToken).toBeTruthy();
    const { status } = await readCc(forgedToken!, wid, instanceId);
    expect([401, 403]).toContain(status);
  });

  it("GET 自己的实例返回 200 且抄送记录含 user 嵌套对象（钉住 405 不再回来）", async () => {
    const added = await addCc(ownerToken, wid, instanceId, [ccUserIdA, ccUserIdB]);
    expect(added.status).toBe(200);

    const { status, body } = await readCc(ownerToken, wid, instanceId);
    // 405 = 本缺陷的原始形态（端点没有 GET）；这里必须是 200
    expect(status).toBe(200);
    expect(status).not.toBe(405);

    const rows = body!.data as CcRow[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.id).toBeTruthy();
      expect([ccUserIdA, ccUserIdB]).toContain(r.userId);
      // 前端渲染取 cc.user?.name || cc.user?.email，缺这两个就退化成 "—"
      expect(r.user?.email).toBeTruthy();
      expect(r.read).toBe(false);
      expect(typeof r.nodeIndex).toBe("number");
    }
  });

  it("无抄送记录时返回 200 + 空数组，而不是 405/404", async () => {
    const { status, body } = await readCc(ownerToken, wid, emptyInstanceId);
    expect(status).toBe(200);
    expect(body!.data).toEqual([]);
  });

  it("实例不存在返回 404", async () => {
    // 用合法成员 + 一个不属于本工作区的实例 id（外租户那单）
    const { status } = await readCc(ownerToken, wid, outsiderInstanceId);
    expect(status).toBe(404);
  });

  it("viewer 只读成员也能读抄送列表（读路径不受角色门禁限制）", async () => {
    const { status, body } = await readCc(viewerToken, wid, instanceId);
    expect(status).toBe(200);
    expect((body!.data as CcRow[]).length).toBe(2);
  });
});
