import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// AI 知识问答：页面加载 + 会话列表/新建对话/问答输入渲染。
// 覆盖=壳层与输入；避开 AI 真调用（提问会走流式接口需 Provider，故只断言输入可见）。
test.describe("AI 知识问答", () => {
  test("页面加载后会话侧栏与问答输入渲染", async ({ page }) => {
    test.setTimeout(180_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-kq-owner"), "E2E知识问答工作区");

    await page.goto(`/w/${wid}/knowledge-qa`);
    await expect(page.locator('[aria-label="AI 知识问答"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "新建对话" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder("输入你的问题…")).toBeVisible({ timeout: 10_000 });
  });
});
