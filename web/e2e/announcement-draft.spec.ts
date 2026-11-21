import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// AI 公告起草：页面加载 + 主题输入与生成入口渲染。
// 覆盖=壳层与入口；避开 AI 真调用（点生成会走流式接口需 Provider，故只断言入口可见）。
test.describe("AI 公告起草", () => {
  test("页面加载后主题输入与生成入口渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-ad-owner"), "E2E公告起草工作区");

    await page.goto(`/w/${wid}/announcement-draft`);
    await expect(page.getByRole("heading", { name: "AI 公告起草" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByLabel("输入公告主题…", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "生成草稿" })).toBeVisible();
  });
});
