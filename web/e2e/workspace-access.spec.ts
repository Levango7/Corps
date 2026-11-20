import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 认证壳层：被邀请成员经 URL 直达（不经切换器）进入他人工作区。
// 缺陷背景：JWT 内嵌 wid 锁在注册时工作区；layout 此前仅在切换器点击时 refresh（:240），
// URL 直达不触发 ⇒ getWorkspaceContextV2 的 payload.wid!==wid 判 workspace_mismatch 403，
// 且 api() 的 401-refresh 不带 wid（members[0] 通常为自有区）⇒ 永不自愈。
// 本用例**不做任何手动 refresh**——正是「URL 直达」形态；修复后 layout 在 wid 变化时自动 refresh。
test.describe("认证壳层：被邀请成员 URL 直达跨工作区", () => {
  test("B 直达 A 的看板：正常加载而非 workspace_mismatch 403", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctxA = await browser.newContext({ locale: "zh-CN" });
    const pageA = await ctxA.newPage();
    const wid = await registerAndLogin(pageA, uniqueEmail("e2e-ws-owner"), "E2E跨区访问工作区");

    const ctxB = await browser.newContext({ locale: "zh-CN" });
    const pageB = await ctxB.newPage();
    const emailB = uniqueEmail("e2e-ws-member");
    await registerAndLogin(pageB, emailB, "成员自有工作区");
    const invite = await pageA.request.post(`/api/v1/workspaces/${wid}/members/invite`, {
      data: { email: emailB, role: "member" },
    });
    expect(invite.status(), "owner 邀请成员应成功").toBe(201);

    // B 不做任何手动 refresh（token wid 仍指向 B 的自有工作区），直接 URL 进入 A 的看板。
    // 看板属 v1 路由（无 wid 守卫）所以天然可达；真正的分水岭在 v2 路由（remote-control/analytics）。
    await pageB.goto(`/w/${wid}/board`);
    await expect(pageB.getByRole("button", { name: /新建任务|New Task/ })).toBeVisible({
      timeout: 20_000,
    });
    // 等 layout 初始化完成（看板已渲染）后直调 v2 路由：
    // 修复前 token wid 仍为 B 自有 ⇒ remote-control 列表 403（workspace_mismatch）；
    // 修复后 layout 已自动 refresh ⇒ 200。
    const res = await pageB.request.get(`/api/v1/remote-control?workspaceId=${wid}`);
    expect(res.status(), "v2 路由应放行（layout 已自动 refresh 切到目标工作区）").toBe(200);

    await ctxA.close();
    await ctxB.close();
  });
});
