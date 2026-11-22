import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// AI 智能日报：页面加载 + 日期选择与生成入口渲染。
// 覆盖=壳层与生成入口；避开 AI 真调用（点生成会走流式接口需 Provider，故只断言入口可见）。
test.describe("AI 智能日报", () => {
  test("页面加载后生成入口与日期选择渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-daily"), "E2E日报工作区");

    await page.goto(`/w/${wid}/daily-report`);
    await expect(page.getByText("选择日期", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "生成日报" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
