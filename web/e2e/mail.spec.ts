import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 邮箱域壳层：页面挂载 + 账户设置空态 + 手动同步入口。
// 覆盖=真实链路：mail/page 挂载 MailSettings/MailComposer/MailList 三组件，
// 新账户无邮箱账户 → 设置空态 + 收件箱空态均渲染。
// 同步按钮只验证入口可见（E2E 环境无真实 IMAP 服务器，不触发同步动作）。
test.describe("邮箱", () => {
  test("页面加载后账户设置空态、写邮件入口与同步按钮渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-mail-owner"), "E2E邮箱工作区");

    await page.goto(`/w/${wid}/mail`);
    await expect(page.getByRole("heading", { name: "邮箱" })).toBeVisible({ timeout: 20_000 });
    // 账户设置卡片：新工作区无邮箱账户 → 空态文案
    const settings = page.getByLabel("邮箱设置");
    await expect(settings.getByText("请先添加邮箱账户", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    // 手动同步入口（不点击：无真实 IMAP 服务器可连）
    await expect(page.getByRole("button", { name: "立即同步" })).toBeVisible({ timeout: 10_000 });
    // 写邮件卡片（Composer 容器）
    await expect(page.getByLabel("写邮件")).toBeVisible({ timeout: 10_000 });
    // 收件列表空态
    await expect(page.getByText("暂无邮件", { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
