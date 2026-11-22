import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// IM 消息：页面加载 + 会话过滤输入与新建会话入口渲染。
// 覆盖=真实链路：IMClient 挂载 → ConversationList 渲染（会话过滤/新建入口）。
// 收发消息链路（WebSocket）已由 im-upgrade.spec 覆盖升级场景，本批补壳层。
test.describe("IM 消息", () => {
  test("页面加载后会话过滤输入与新建会话入口渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-im-owner"), "E2E消息工作区");

    await page.goto(`/w/${wid}/im`);
    await expect(page.getByPlaceholder("过滤会话")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "新建会话" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("还没有消息，发一条开始对话吧。", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
