import { expect, test } from "@playwright/test";

/**
 * E2E 浏览器级冒烟：注册 → 进入工作区 → 新建任务入口可用。
 *
 * 覆盖的是单测/集成测试无法覆盖的真实浏览器路径：
 *   React 表单交互、cookie 会话下发后的客户端路由跳转、
 *   生产/开发模式下页面水合(hydration)后的 UI 可用性。
 *
 * 前置条件：
 *   - 目标 server 已运行且 RATE_LIMIT_DISABLED=1（本地 run-dev 或 CI e2e job）
 *   - 数据库可达（注册要真实落库）
 */

const uniqueEmail = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;

test.describe.serial("冒烟：注册 → 工作区 → 新建任务", () => {
  test("注册页正常渲染（水合完成，表单可交互）", async ({ page }) => {
    await page.goto("/auth/signup");
    await expect(page).toHaveTitle(/Corps/i);
    await expect(page.getByLabel("邮箱")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
    await expect(page.getByRole("button", { name: "创建并进入" })).toBeEnabled();
  });

  test("注册成功后跳转到新建的工作区", async ({ page }) => {
    await page.goto("/auth/signup");
    await page.getByLabel("邮箱").fill(uniqueEmail);
    await page.getByLabel("密码").fill("e2e-smoke-passw0rd");
    // 工作区名字段为必填（见 signup 页 workspaceName state）
    const wsField = page.getByLabel(/工作区/);
    if (await wsField.isVisible()) {
      await wsField.fill(`E2E冒烟工作区${Date.now()}`);
    }
    await page.getByRole("button", { name: "创建并进入" }).click();

    // 注册成功 → 客户端路由到 /w/<uuid>
    await page.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/i);
  });

  test("工作区内「新建任务」入口可见且可点击", async ({ page }) => {
    // 直接走 API 登录拿会话？不行——会话在浏览器 cookie 里。
    // 复用上一步的注册流程重新登录一次，保证本测试独立于执行顺序的脆弱性。
    await page.goto("/auth/login");
    await page.getByLabel("邮箱").fill(uniqueEmail);
    await page.getByLabel("密码").fill("e2e-smoke-passw0rd");
    await page.getByRole("button", { name: /登录/ }).click();
    await page.waitForURL(/\/w\//, { timeout: 20_000 });

    const newTaskBtn = page.getByRole("button", { name: "新建任务" }).first();
    await expect(newTaskBtn).toBeVisible();
    await newTaskBtn.click();
    // 点击后弹出 NewTaskDialog，标题输入框 placeholder 见 components/NewTaskDialog.tsx:192
    await expect(page.getByPlaceholder("一句话说清要做什么")).toBeVisible({ timeout: 10_000 });
  });
});
