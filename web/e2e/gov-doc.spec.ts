import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 公文域：登记→列表出现→状态为拟稿；viewer 无登记入口。
// 覆盖=真实链路：gov-docs POST 创建 → 列表渲染 → 角色入口收敛。
// 状态跃迁（拟稿→审核→签发）与详情展开区（交换留痕/意见/附件）留待后续批次。
test.describe("公文管理", () => {
  test("登记公文→列表出现且状态为拟稿；viewer 无登记入口", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctxA = await browser.newContext({ locale: "zh-CN" });
    const pageA = await ctxA.newPage();
    const wid = await registerAndLogin(pageA, uniqueEmail("e2e-gd-owner"), "E2E公文工作区");
    const title = `E2E收文登记-${Date.now()}`;

    await pageA.goto(`/w/${wid}/gov-doc`);
    await pageA.getByRole("button", { name: "登记公文" }).click();
    await pageA.getByLabel("标题", { exact: true }).fill(title);
    await pageA.getByRole("button", { name: "提交登记" }).click();
    // 列表出现该公文 + 状态=拟稿
    await expect(pageA.getByText(title, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByText("拟稿", { exact: true }).first()).toBeVisible();

    // B viewer（先 PATCH role=viewer）→ gov-doc 页无「登记公文」按钮
    const ctxB = await browser.newContext({ locale: "zh-CN" });
    const pageB = await ctxB.newPage();
    const emailB = uniqueEmail("e2e-gd-viewer");
    await registerAndLogin(pageB, emailB, "viewer 自有工作区");
    const invite = await pageA.request.post(`/api/v1/workspaces/${wid}/members/invite`, {
      data: { email: emailB, role: "member" },
    });
    expect(invite.status()).toBe(201);
    const members = await pageA.request.get(`/api/v1/workspaces/${wid}/members`);
    const list = (await members.json()) as {
      data: { items: Array<{ id: string; email: string }> };
    };
    const target = list.data.items.find((m) => m.email === emailB);
    expect(target).toBeTruthy();
    const setRole = await pageA.request.patch(`/api/v1/workspaces/${wid}/members/${target!.id}`, {
      data: { role: "viewer" },
    });
    expect(setRole.status()).toBe(200);

    await pageB.goto(`/w/${wid}/gov-doc`);
    await expect(pageB.getByRole("button", { name: "登记公文" })).toHaveCount(0, {
      timeout: 15_000,
    });

    await ctxA.close();
    await ctxB.close();
  });
});
