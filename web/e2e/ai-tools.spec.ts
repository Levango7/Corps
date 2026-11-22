import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// AI 工具中心：标题 + Tab 栏 + Tab 切换（点「项目洞察」→ 内嵌 ProjectInsightView 渲染）。
// 覆盖=真实链路：页面壳层 + Tab 导航 + 懒加载面板挂载；避开 AI 真调用（CI 无 Provider）。
test.describe("AI 工具中心", () => {
  test("标题与 Tab 栏渲染，点「项目洞察」后内嵌面板出现", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-ai-tools"), "E2E工具中心工作区");

    await page.goto(`/w/${wid}/ai-tools`);
    await expect(page.getByRole("heading", { name: "AI 工具中心" })).toBeVisible({
      timeout: 20_000,
    });
    // Tab 栏：四个代表性 Tab 可见（ai-tools 用 role=tab，非 button）
    for (const tab of ["语义搜索", "邮件助手", "项目洞察", "智能日报"]) {
      await expect(page.getByRole("tab", { name: tab, exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }
    // 点「项目洞察」Tab → 内嵌 ProjectInsightView 渲染（其自身 tab「进度分析」出现）
    await page.getByRole("tab", { name: "项目洞察", exact: true }).click();
    await expect(page.getByText("进度分析", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
