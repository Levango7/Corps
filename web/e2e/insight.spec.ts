import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// AI 项目经理洞察：页面加载 + ProjectInsightView 四 tab 渲染。
// 覆盖=壳层与 Tab 导航；避开 AI 真调用（流式生成需 Provider，点 tab 会触发请求故不点）。
test.describe("AI 项目经理洞察", () => {
  test("页面加载后四 tab 渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-insight"), "E2E洞察工作区");

    await page.goto(`/w/${wid}/insight`);
    await expect(page.getByText("进度分析", { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("风险识别", { exact: true })).toBeVisible();
    await expect(page.getByText("综合概览", { exact: true })).toBeVisible();
    await expect(page.getByText("周报", { exact: true })).toBeVisible();
  });
});
