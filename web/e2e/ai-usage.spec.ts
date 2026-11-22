import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// AI 使用统计：标题 + 用量仪表盘渲染 + 限额设置渲染。
// 覆盖=真实链路：页面壳层 + GET /ai/usage/dashboard 与 /limits 只读拉取（无需 AI Provider）。
test.describe("AI 使用统计", () => {
  test("标题、用量仪表盘与限额设置渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-ai-usage"), "E2E用量工作区");

    await page.goto(`/w/${wid}/ai-usage`);
    await expect(page.getByRole("heading", { name: "AI 使用统计" })).toBeVisible({
      timeout: 20_000,
    });
    // 仪表盘渲染标志：「调用次数」标签可见（空数据态也有标签）
    await expect(page.getByText("调用次数", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    // 限额设置渲染标志：「限额设置」标题可见
    await expect(page.getByText("限额设置", { exact: true }).first()).toBeVisible();
  });
});
