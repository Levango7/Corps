import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 会议纪要：页面加载 + 标题与新建入口渲染。
// 覆盖=真实链路：MinutesList 拉取 GET /meeting-minutes 列表 → 新建入口可见。
test.describe("会议纪要", () => {
  test("页面加载后标题与新建入口渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-mm-owner"), "E2E纪要工作区");

    await page.goto(`/w/${wid}/meeting-minutes`);
    await expect(page.getByText("会议纪要", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "新建纪要" })).toBeVisible({ timeout: 10_000 });
  });
});
