import { expect, test, type Browser, type Page } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 远程控制域：双账号会话生命周期 + 权限边界。
// 覆盖=真实链路：注册/邀请建成员 → POST 创建会话（pending）→ 面板 UI 接受/拒绝/结束。
// 诚实说明：
//  - 视频流面（RemoteViewer 的 WebRTC 媒体采集与键鼠回传）不在本批——无头浏览器无屏幕共享设备；
//    本批钉「会话状态机 + 面板交互 + 权限边界」。接受方（target）页面不渲染 viewer
//    （page.tsx 仅 initiatorId===currentUserId 才挂 RemoteViewer），接受侧 UI 全程无媒体依赖。
//  - 发起方活跃态走 API 断言（A 若在接受后打开页面会触发 viewer，避开）。

/** 会话 DTO（API 返回 data 字段，仅取本批用到的键） */
interface SessionDTO {
  id: string;
  status: string;
  initiatorId: string;
  targetId: string;
}

/** 从 /users/me 拿当前用户 id（envelope data 直接摊平用户对象，含 id/email） */
async function myUserId(page: Page): Promise<string> {
  const res = await page.request.get("/api/v1/users/me");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/** API 发起远程控制请求，返回 pending 会话 DTO */
async function createSession(page: Page, wid: string, targetUserId: string): Promise<SessionDTO> {
  const res = await page.request.post("/api/v1/remote-control", {
    data: { targetUserId, workspaceId: wid },
  });
  expect(res.status(), "创建远程控制请求应 201").toBe(201);
  const body = (await res.json()) as { data: SessionDTO };
  expect(body.data.status).toBe("pending");
  return body.data;
}

/** API 拉取当前用户在该工作区的会话列表（默认 pending+active） */
async function listSessions(page: Page, wid: string): Promise<SessionDTO[]> {
  const res = await page.request.get(`/api/v1/remote-control?workspaceId=${wid}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: SessionDTO[] };
  return body.data;
}

/**
 * 模拟「切换工作区」动作：显式刷新 token 到目标工作区（layout 切换器同款 refresh）。
 * 被邀请成员的 JWT wid 仍指向注册时工作区，直接 API 操作新工作区会 workspace_mismatch 403——
 * 真实用户经切换器进入时会自动 refresh（layout.switchWorkspace）。
 */
async function refreshToWorkspace(page: Page, wid: string): Promise<void> {
  const res = await page.request.post("/api/v1/auth/refresh", { data: { workspaceId: wid } });
  expect(res.status(), "切换工作区刷新令牌应成功").toBe(200);
}

/** 双账号夹具：A=owner（widA），B=member（已加入 widA）。 */
async function setupTwoMembers(browser: Browser) {
  const ctxA = await browser.newContext({ locale: "zh-CN" });
  const pageA = await ctxA.newPage();
  const wid = await registerAndLogin(pageA, uniqueEmail("e2e-rc-owner"), "E2E远程控制工作区");

  const ctxB = await browser.newContext({ locale: "zh-CN" });
  const pageB = await ctxB.newPage();
  const emailB = uniqueEmail("e2e-rc-member");
  await registerAndLogin(pageB, emailB, "成员自有工作区");
  const invite = await pageA.request.post(`/api/v1/workspaces/${wid}/members/invite`, {
    data: { email: emailB, role: "member" },
  });
  expect(invite.status(), "owner 邀请成员应成功").toBe(201);
  await refreshToWorkspace(pageB, wid);
  return { ctxA, pageA, ctxB, pageB, wid, emailB };
}

test.describe("远程控制：会话生命周期与权限边界", () => {
  test("UI 主线：A 面板发起 → B 接受 → B 活跃 → B 结束 → 双侧列表清空", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ctxA, pageA, ctxB, pageB, wid, emailB } = await setupTwoMembers(browser);
    const displayNameB = emailB.split("@")[0]; // 注册未传 name 时默认邮箱本地部分（register route.ts:52）

    // A 打开远程控制页，UI 发起请求（选 B）
    await pageA.goto(`/w/${wid}/remote-control`);
    await expect(pageA.getByRole("heading", { name: "远程控制" }).first()).toBeVisible({
      timeout: 15_000,
    });
    // 初始无任何会话分组
    await expect(pageA.getByText(/传出请求 ·/)).toHaveCount(0);
    await expect(pageA.getByText(/传入请求 ·/)).toHaveCount(0);
    await pageA.getByRole("button", { name: "发起请求" }).first().click();
    await pageA.locator("aside select").selectOption({ label: displayNameB });
    await pageA.getByRole("button", { name: "发起请求" }).last().click();
    // A 面板传出请求 pending
    await expect(pageA.getByText(/传出请求 · 1/)).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByText("等待对方接受")).toBeVisible();

    // B 打开页面：传入请求 pending → 接受
    await pageB.goto(`/w/${wid}/remote-control`);
    await expect(pageB.getByText(/传入请求 · 1/)).toBeVisible({ timeout: 15_000 });
    await pageB.getByTitle("接受", { exact: true }).click();
    // B 面板：活跃会话 + 已连接（B 为 target，page 不渲染 viewer，无媒体依赖）
    await expect(pageB.getByText(/活跃会话 · 1/)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText("已连接")).toBeVisible();
    // A 侧（initiator）走 API 断言活跃（避免打开页面触发 viewer）
    const active = await listSessions(pageA, wid);
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("active");

    // B 结束会话 → B 面板活跃组消失；A API 列表清空（ended 不返回）
    await pageB.getByTitle("结束", { exact: true }).click();
    await expect(pageB.getByText(/活跃会话 ·/)).toHaveCount(0, { timeout: 10_000 });
    await expect(pageB.getByText("暂无活跃会话").first()).toBeVisible();
    expect(await listSessions(pageA, wid)).toHaveLength(0);

    await ctxA.close();
    await ctxB.close();
  });

  test("拒绝路径：B 拒绝后列表清空，重复接受 409", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ctxA, pageA, ctxB, pageB, wid } = await setupTwoMembers(browser);
    const userIdB = await myUserId(pageB);
    const session = await createSession(pageA, wid, userIdB);

    await pageB.goto(`/w/${wid}/remote-control`);
    await expect(pageB.getByText(/传入请求 · 1/)).toBeVisible({ timeout: 15_000 });
    await pageB.getByTitle("拒绝", { exact: true }).click();
    await expect(pageB.getByText(/传入请求 ·/)).toHaveCount(0, { timeout: 10_000 });
    expect(await listSessions(pageA, wid)).toHaveLength(0);

    // 已拒绝会话再接受 → 409 alreadyProcessed
    const again = await pageB.request.patch(
      `/api/v1/remote-control/${session.id}?workspaceId=${wid}`,
      {
        data: { action: "accept" },
      },
    );
    expect(again.status()).toBe(409);

    await ctxA.close();
    await ctxB.close();
  });

  test("权限边界：自发起/非成员/非参与方/发起方接受/缺参/重复处理", async ({ browser }) => {
    test.setTimeout(180_000);
    const { ctxA, pageA, ctxB, pageB, wid } = await setupTwoMembers(browser);
    const userIdB = await myUserId(pageB);
    const userIdA = await myUserId(pageA);

    // 向自己发起 → 400
    const self = await pageA.request.post("/api/v1/remote-control", {
      data: { targetUserId: userIdA, workspaceId: wid },
    });
    expect(self.status()).toBe(400);

    // 第三账号 C（未加入 widA）：A 向非成员 C 发起 → 400；C 接受会话 → 403（工作区级）
    const ctxC = await browser.newContext({ locale: "zh-CN" });
    const pageC = await ctxC.newPage();
    await registerAndLogin(pageC, uniqueEmail("e2e-rc-outsider"), "旁观者自有工作区");
    const userIdC = await myUserId(pageC);
    const outsider = await pageA.request.post("/api/v1/remote-control", {
      data: { targetUserId: userIdC, workspaceId: wid },
    });
    expect(outsider.status()).toBe(400);

    // A→B 正常会话 pending：发起方 A 接受 → 403 notTarget；非成员 C 接受 → 403
    const session = await createSession(pageA, wid, userIdB);
    const acceptByInitiator = await pageA.request.patch(
      `/api/v1/remote-control/${session.id}?workspaceId=${wid}`,
      { data: { action: "accept" } },
    );
    expect(acceptByInitiator.status()).toBe(403);
    const acceptByOutsider = await pageC.request.patch(
      `/api/v1/remote-control/${session.id}?workspaceId=${wid}`,
      { data: { action: "accept" } },
    );
    expect(acceptByOutsider.status()).toBe(403);

    // 缺 workspaceId 参数 → 400
    const noWid = await pageB.request.patch(`/api/v1/remote-control/${session.id}`, {
      data: { action: "accept" },
    });
    expect(noWid.status()).toBe(400);

    // C 被邀请进 widA（成员但非会话参与方）→ 接受 → 403 notParticipant
    const meCRes = await pageC.request.get("/api/v1/users/me");
    const meC = (await meCRes.json()) as { data: { id: string; email: string } };
    const inviteC = await pageA.request.post(`/api/v1/workspaces/${wid}/members/invite`, {
      data: { email: meC.data.email, role: "member" },
    });
    expect(inviteC.status()).toBe(201);
    await refreshToWorkspace(pageC, wid);
    const acceptByNonParticipant = await pageC.request.patch(
      `/api/v1/remote-control/${session.id}?workspaceId=${wid}`,
      { data: { action: "accept" } },
    );
    expect(acceptByNonParticipant.status()).toBe(403);

    // B 接受成功后再重复接受 → 409 alreadyProcessed
    const ok = await pageB.request.patch(
      `/api/v1/remote-control/${session.id}?workspaceId=${wid}`,
      {
        data: { action: "accept" },
      },
    );
    expect(ok.status()).toBe(200);
    const dup = await pageB.request.patch(
      `/api/v1/remote-control/${session.id}?workspaceId=${wid}`,
      {
        data: { action: "accept" },
      },
    );
    expect(dup.status()).toBe(409);

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  });
});
