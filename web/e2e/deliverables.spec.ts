import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// AI 交付域壳层：页面挂载 + 提交表单 + 任务列表态。
// CI/本机无 sidecar 时列表区走「服务未就绪」文案（稳定断言）；
// 提交动作不触发（sidecar 缺席时 502 语义已由 API 单测钉住）。
test.describe("AI 交付", () => {
  test("页面加载后标题、新建任务表单与服务未就绪提示渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-deliv-owner"), "E2E交付工作区");

    await page.goto(`/w/${wid}/deliverables`);
    // h1=nav.deliverables（「交付」）；页内 h3「交付任务」「新建交付任务」是子串，
    // 用 exact + level 1 防歧义
    await expect(page.getByRole("heading", { name: "交付", exact: true, level: 1 })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("主题或需求")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByLabel("流水线")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "提交任务" })).toBeVisible({ timeout: 10_000 });
    // 列表区两态任一可见：sidecar 缺席→「服务未就绪」；在场→「还没有交付任务」空态
    await expect(
      page
        .getByText("交付服务未就绪", { exact: false })
        .or(page.getByText("还没有交付任务", { exact: true })),
    ).toBeVisible({ timeout: 20_000 });
  });
});
