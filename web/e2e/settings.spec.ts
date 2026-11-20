import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 设置域：owner 改工作区名保存生效；member 只读无保存入口。
// 覆盖=真实链路：设置页读写 /workspaces/[wid] → 保存后重载值保持 + 角色入口收敛。
test.describe("设置", () => {
  test("owner 改名保存生效；member 只读无保存入口", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctxA = await browser.newContext({ locale: "zh-CN" });
    const pageA = await ctxA.newPage();
    const wid = await registerAndLogin(pageA, uniqueEmail("e2e-set-owner"), "E2E设置工作区");

    // A 改工作区名称并保存
    await pageA.goto(`/w/${wid}/settings`);
    const nameInput = pageA.locator("#ws-name");
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    const newName = `E2E改名工作区-${Date.now()}`;
    await nameInput.fill(newName);
    await pageA
      .locator("section", { has: pageA.locator("#ws-name") })
      .getByRole("button", { name: "保存修改" })
      .click();
    await expect(pageA.getByText("已保存", { exact: true })).toBeVisible({ timeout: 10_000 });
    // 重新加载后值保持
    await pageA.reload();
    await expect(pageA.locator("#ws-name")).toHaveValue(newName, { timeout: 15_000 });

    // B 注册并被邀请进 widA（member）→ 设置页只读
    const ctxB = await browser.newContext({ locale: "zh-CN" });
    const pageB = await ctxB.newPage();
    const emailB = uniqueEmail("e2e-set-member");
    await registerAndLogin(pageB, emailB, "成员自有工作区");
    const invite = await pageA.request.post(`/api/v1/workspaces/${wid}/members/invite`, {
      data: { email: emailB, role: "member" },
    });
    expect(invite.status()).toBe(201);

    await pageB.goto(`/w/${wid}/settings`);
    await expect(pageB.locator("#ws-name")).toBeDisabled({ timeout: 15_000 });
    await expect(
      pageB.getByText("你的角色为「成员」，仅拥有者或管理员可修改工作区信息。", { exact: true }),
    ).toBeVisible();
    await expect(
      pageB.locator("section", { has: pageB.locator("#ws-name") }).getByRole("button", {
        name: "保存修改",
      }),
    ).toHaveCount(0);

    await ctxA.close();
    await ctxB.close();
  });
});
