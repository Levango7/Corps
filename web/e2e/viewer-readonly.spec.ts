import { test, expect } from "@playwright/test";

import { registerAndLogin, uniqueEmail } from "./helpers";

/**
 * viewer（只读成员）端到端。
 *
 * 为什么单独有这张文件：全仓 E2E 此前 **0 个 viewer 断言**，
 * 于是"矩阵声明 viewer 只读、但写接口不校验角色"这个洞长期只在集成测试视角可见。
 * 这张卡把边界钉在真实浏览器会话上：同域 cookie 走一遍读与写。
 *
 * 现状如实记录（不替 UI 做承诺）：前端目前仍会给只读成员渲染写操作入口
 * （组件里没有 viewer 判定），所以这里断言的是"读得到 / 写被服务端 403 拒"，
 * 不断言按钮被隐藏 —— UI 侧的入口抑制是另一件事，留给产品决定。
 */

/** 列表端点历史上有裸数组与 { items } 两种形状，这里两种都吃，避免用例因信封漂移而假红 */
function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const items = (payload as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

test("viewer 可读看板、可看任务详情，但写入被服务端拒绝", async ({ browser }) => {
  // 链路较长（双账号注册 + 邀请 + 切工作区上下文 + 建任务 + 3 次写校验 + 页面渲染），
  // 默认 60s 在 CI 上不够：实测本用例在 CI 与本地都曾在断言等待 20s 后撞总超时。
  test.setTimeout(120_000);
  // 1) 先注册"将来只读"的账号（它自带一个独立工作区，不影响后面的断言）
  const viewerCtx = await browser.newContext();
  const vp = await viewerCtx.newPage();
  const viewerEmail = uniqueEmail("e2e-viewer");
  await registerAndLogin(vp, viewerEmail, "viewer 自有工作区");

  // 2) owner 注册并邀请上面的账号加入自己的工作区
  const ownerCtx = await browser.newContext();
  const op = await ownerCtx.newPage();
  const wid = await registerAndLogin(op, uniqueEmail("e2e-owner"), "viewer 权限 E2E");

  const invite = await ownerCtx.request.post(`/api/v1/workspaces/${wid}/members/invite`, {
    data: { email: viewerEmail },
  });
  expect(invite.status(), "owner 邀请成员应成功").toBe(201);

  // 3) 把该成员改成 viewer（这条 PATCH 在 f2f926ed 之后才对 viewer 开放）
  const members = await ownerCtx.request.get(`/api/v1/workspaces/${wid}/members`);
  expect(members.status()).toBe(200);
  // GET /members 的条目形状是 { id(=userId), email, name, image, role, isSelf, joinedAt }
  // （route.ts:71-79 把 m.user.id 摊平成 id），没有 userId / user 两个嵌套字段
  const list = asList<{ id?: string; userId?: string; email?: string }>(
    (await members.json()).data,
  );
  const viewerMember = list.find((m) => m.email === viewerEmail);
  expect(viewerMember, "成员列表里应能找到被邀请的邮箱").toBeTruthy();
  const viewerUserId = viewerMember!.id ?? viewerMember!.userId;
  expect(viewerUserId, "成员条目应带 user id").toBeTruthy();

  const setRole = await ownerCtx.request.patch(
    `/api/v1/workspaces/${wid}/members/${viewerUserId}`,
    { data: { role: "viewer" } },
  );
  expect(setRole.status(), "把成员改为只读应成功（此前枚举不含 viewer，会 400）").toBe(200);

  // 4) viewer 的 token 切到 owner 的工作区（access_token 绑定 wid），再以 viewer 身份访问
  const switched = await viewerCtx.request.post("/api/v1/auth/refresh", {
    data: { workspaceId: wid },
  });
  expect(switched.status(), "切换工作区上下文应成功").toBe(200);

  // 4.5) owner 先建一条任务。空工作区的看板只渲染空状态（没有「任务看板」标题、
  //      也没有列），所以不播种的话"读得到"这条断言其实什么都没验证。
  const ownerTask = await ownerCtx.request.post(`/api/v1/workspaces/${wid}/tasks`, {
    data: { title: `owner 建的任务-${Date.now()}` },
  });
  expect(ownerTask.status(), "owner 建任务应成功").toBe(201);
  const ownerTaskJson = await ownerTask.json();
  const taskId: string = ownerTaskJson.data.id;
  const taskTitle: string = ownerTaskJson.data.title;

  // 5) 读：看板正常渲染（不是错误边界），且能看到 owner 建的那条任务
  await vp.goto(`/w/${wid}/board`);
  await expect(vp.getByRole("heading", { name: /看板|任务看板/ })).toBeVisible({
    timeout: 20_000,
  });
  // BoardView 为移动/桌面断点各渲染一份卡片；`.first()` 会命中断点下隐藏的那份
  //（实测 locator 已解析到该 <p> 但 received "hidden"），须按可见性过滤，
  //  口径同 task-management.spec.ts 里的 .filter({ visible: true }).first()
  await expect(vp.getByText(taskTitle).filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  // 页面不能是路由级错误边界（error.tsx 的 role="alert" + "页面出错了"文案）。
  // 注意：**不要**直接统计 `[role="alert"]`——`next dev` 的 DevTools 浮层也注入一个空 alert
  //（实测本地失败点快照里那个 alert 就紧跟 "Open Next.js Dev Tools"），会把本应在生产
  // 构建下通过的页面在本地判红。断言文案才有意义。
  await expect(vp.getByText(/页面出错了|Something went wrong/)).toHaveCount(0);

  // 6) 写：创建任务必须被服务端拒绝
  // 状态码口径（2026-10-03 起）：写请求先过 lib/auth.ts 的统一 choke point，
  // viewer 在 getWorkspaceContext 就被拒（handler 走既有 401 分支），
  // 因此这里接受 401 或 403；**断言的实质是"不许 2xx"**，不是钉死某个数字。
  const create = await viewerCtx.request.post(`/api/v1/workspaces/${wid}/tasks`, {
    data: { title: "viewer 不该建成的任务" },
  });
  expect([401, 403]).toContain(create.status());

  // 7) 写：改已有任务也必须被拒绝
  const patch = await viewerCtx.request.patch(`/api/v1/workspaces/${wid}/tasks/${taskId}`, {
    data: { title: "viewer 不该改动的标题" },
  });
  expect([401, 403]).toContain(patch.status());

  // 8) AI 落位面同样不得绕过：经 ai/tools/execute 建任务
  const aiExec = await viewerCtx.request.post("/api/v1/ai/tools/execute", {
    data: {
      toolName: "create_task",
      args: { title: "viewer 不该经 AI 建成的任务" },
      workspaceId: wid,
    },
  });
  expect([401, 403]).toContain(aiExec.status());

  await ownerCtx.close();
  await viewerCtx.close();
});
