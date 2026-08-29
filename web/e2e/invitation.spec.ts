import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin, login } from "./helpers";

/**
 * E2E：邀请流程 —— 管理员邀请成员 → 成员接受邀请 → 加入工作区。
 *
 * 覆盖：
 *  - 成员页邀请输入框 + 邀请按钮交互
 *  - 未注册邮箱邀请：后端返回可分享的邀请链接
 *  - 受邀人用邀请链接注册（?invite=<token>）
 *  - 注册后自动接受邀请，跳转到邀请方工作区
 *  - 新成员能在工作区内看到内容
 *
 * 独立性：owner 和 invitee 各用唯一邮箱，两个 browser context 隔离会话。
 */

const ownerEmail = uniqueEmail("e2e-inv-owner");
const inviteeEmail = uniqueEmail("e2e-inv-member");

/** 邀请链接在 test 间传递（serial 保证顺序）。 */
let inviteUrl: string;
let ownerWorkspaceId: string;

test.describe.serial("邀请流程：管理员邀请 → 成员接受 → 加入工作区", () => {
  test("管理员注册并进入工作区", async ({ page }) => {
    ownerWorkspaceId = await registerAndLogin(page, ownerEmail, "E2E邀请工作区");
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible({ timeout: 10_000 });
  });

  test("管理员在成员页邀请未注册邮箱，获取邀请链接", async ({ page }) => {
    await login(page, ownerEmail);

    // 进入成员页
    await page.goto(`/w/${ownerWorkspaceId}/members`);
    await expect(page.getByRole("heading", { name: "成员" })).toBeVisible({ timeout: 10_000 });

    // 邀请输入框 + 邀请按钮
    const inviteInput = page.getByPlaceholder("输入邮箱地址（未注册也可邀请）");
    await expect(inviteInput).toBeVisible();

    await inviteInput.fill(inviteeEmail);
    // exact：页面另有一个工作区切换按钮名含"邀请"字样
    await page.getByRole("button", { name: "邀请", exact: true }).click();

    // 邀请成功提示（未注册用户：展示可分享的邀请链接）
    await expect(page.getByText(/已为.*创建邀请/)).toBeVisible({ timeout: 10_000 });

    // 提取邀请链接（<code> 元素内）
    const codeEl = page.locator("code").first();
    await expect(codeEl).toBeVisible({ timeout: 5_000 });
    inviteUrl = (await codeEl.textContent()) ?? "";
    expect(inviteUrl).toContain("invite=");
  });

  test("受邀人用邀请链接注册并自动加入工作区", async ({ browser }) => {
    // 用新 browser context 模拟受邀人（无 owner 会话）
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();

    // 拼接完整 URL（inviteUrl 可能是相对路径或完整 URL）
    const fullUrl = inviteUrl.startsWith("http")
      ? inviteUrl
      : new URL(inviteUrl, "http://localhost:3000").toString();

    await inviteePage.goto(fullUrl);

    // 注册页应显示邀请上下文提示
    await expect(inviteePage.getByText(/邀请你加入/)).toBeVisible({ timeout: 10_000 });

    // 用被邀请邮箱注册（工作区名可不填，因为带邀请 token 时注册后加入对方工作区）
    // 注意：signup 页工作区名必填，填一个临时名（注册后会被邀请覆盖跳转）
    const wsField = inviteePage.getByLabel("工作区名称");
    if (await wsField.isVisible()) {
      await wsField.fill("临时工作区");
    }
    await inviteePage.getByLabel("邮箱").fill(inviteeEmail);
    await inviteePage.getByLabel("密码").fill("e2e-test-passw0rd");
    await inviteePage.getByRole("button", { name: "创建并进入" }).click();

    // 注册 + 接受邀请后，跳转到 owner 的工作区
    await inviteePage.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 20_000 });
    const finalUrl = inviteePage.url();
    expect(finalUrl).toContain(ownerWorkspaceId);

    // 验证能进入工作区首页
    await expect(inviteePage.getByRole("heading", { name: "概览" })).toBeVisible({
      timeout: 10_000,
    });

    await inviteeContext.close();
  });
});
