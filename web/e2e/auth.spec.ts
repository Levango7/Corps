import { expect, test } from "@playwright/test";

/**
 * E2E：注册 → 登录 → 创建工作区 → 进入工作区首页。
 *
 * 覆盖核心认证闭环：
 *  - 注册页表单交互（工作区名/邮箱/密码/密码强度）
 *  - 注册成功后客户端路由跳转到 /w/<uuid>
 *  - 登出后用同一账号登录，进入工作区首页
 *  - 工作区首页「概览」标题与「新建任务」入口可用
 *
 * 前置条件：
 *  - dev server 运行且 RATE_LIMIT_DISABLED=1
 *  - 数据库可达（注册真实落库）
 *
 * 独立性：用时间戳+随机后缀生成唯一邮箱，与其他测试文件互不干扰。
 */

/** 生成全局唯一测试邮箱，避免并行/重跑时撞库。 */
function uniqueEmail(prefix = "e2e-auth"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;
}

const PASSWORD = "e2e-auth-passw0rd";

test.describe.serial("认证流程：注册 → 登录 → 工作区首页", () => {
  const email = uniqueEmail();

  test("注册页渲染完整表单（水合完成，字段可交互）", async ({ page }) => {
    await page.goto("/auth/signup");

    // middleware 会重定向到 /zh/auth/signup，标题由 i18n 提供
    await expect(page.getByRole("heading", { name: "创建工作区" })).toBeVisible();
    await expect(page.getByLabel("工作区名称")).toBeVisible();
    await expect(page.getByLabel("邮箱")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
    await expect(page.getByRole("button", { name: "创建并进入" })).toBeEnabled();
  });

  test("注册成功后跳转到新建的工作区首页", async ({ page }) => {
    await page.goto("/auth/signup");

    await page.getByLabel("工作区名称").fill(`E2E认证工作区${Date.now()}`);
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "创建并进入" }).click();

    // 注册成功 → 客户端路由到 /w/<uuid>
    await page.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/i);

    // 工作区首页应显示「概览」标题
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible({ timeout: 10_000 });
  });

  test("登录页渲染完整表单", async ({ page }) => {
    await page.goto("/auth/login");

    await expect(page.getByRole("heading", { name: "登录 corps" })).toBeVisible();
    await expect(page.getByLabel("邮箱")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
    await expect(page.getByRole("button", { name: "登录" })).toBeEnabled();
  });

  test("用注册账号登录后进入工作区首页", async ({ page }) => {
    await page.goto("/auth/login");

    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();

    // 登录成功 → 跳转到 /w/<uuid>
    await page.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}/i);

    // 工作区首页「新建任务」入口可见
    await expect(page.getByRole("button", { name: "新建任务" }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("登录后访问工作区概览页，统计卡片渲染", async ({ page }) => {
    // 先登录建立会话
    await page.goto("/auth/login");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 20_000 });

    // 概览页三张统计卡：待办 / 进行中 / 已完成
    // exact 匹配统计卡标签——空状态文案（"当前没有进行中的任务。"）也含"进行中"
    await expect(page.getByText("待办", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("进行中", { exact: true })).toBeVisible();
    await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  });
});
