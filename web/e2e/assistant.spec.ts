import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// AI 助理对话：页面加载 + 历史对话/新对话/需求输入渲染。
// 覆盖=壳层与输入；避开 AI 真调用（发送会走流式接口需 Provider，故只断言输入可见）。
test.describe("AI 助理对话", () => {
  test("页面加载后历史对话/新对话/需求输入渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-as-owner"), "E2E助理工作区");

    await page.goto(`/w/${wid}/assistant`);
    await expect(page.getByRole("button", { name: "历史对话" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "新对话" })).toBeVisible();
    await expect(page.getByPlaceholder("输入你的需求...")).toBeVisible({ timeout: 10_000 });
  });
});
