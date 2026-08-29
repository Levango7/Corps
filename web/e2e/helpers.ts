import type { Page } from "@playwright/test";

/**
 * E2E 测试共享辅助函数。
 *
 * 设计：
 *  - 每个测试文件调用 registerAndLogin 注册独立账号，保证并行互不干扰
 *  - 登录态走浏览器 cookie，无需手动管理 token
 *  - 所有辅助函数返回关键信息（workspaceId / URL），供后续断言使用
 */

/** 生成全局唯一测试邮箱，避免并行/重跑时撞库。 */
export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;
}

/** 测试统一密码（≥8 位满足注册校验）。 */
export const TEST_PASSWORD = "e2e-test-passw0rd";

/** 从 /w/<uuid> 路径中提取 workspaceId。 */
export function extractWorkspaceId(url: string): string {
  const match = url.match(/\/w\/([0-9a-f-]{36})/i);
  if (!match) throw new Error(`无法从 URL 提取 workspaceId: ${url}`);
  return match[1];
}

/**
 * 注册新用户并自动登录进入工作区首页。
 *
 * 流程：goto /auth/signup → 填表 → 提交 → 等待跳转 /w/<uuid>
 * 注册成功后 Better Auth 直接下发会话 cookie，无需二次登录。
 *
 * @returns workspaceId（UUID）
 */
export async function registerAndLogin(
  page: Page,
  email: string,
  workspaceName?: string,
): Promise<string> {
  await page.goto("/auth/signup");
  await page.getByLabel("工作区名称").fill(workspaceName ?? `E2E工作区${Date.now()}`);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "创建并进入" }).click();

  await page.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 20_000 });
  return extractWorkspaceId(page.url());
}

/**
 * 用已有账号登录并进入工作区首页。
 *
 * @returns workspaceId（UUID）
 */
export async function login(page: Page, email: string, password = TEST_PASSWORD): Promise<string> {
  await page.goto("/auth/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();

  await page.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 20_000 });
  return extractWorkspaceId(page.url());
}

/**
 * 在工作区内创建一条任务（通过 NewTaskDialog）。
 *
 * 前置：page 已在工作区首页或看板页（有「新建任务」按钮）。
 * @returns 任务标题（供后续在看板/详情页定位）
 */
export async function createTask(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: "新建任务" }).first().click();
  await page.getByPlaceholder("一句话说清要做什么").fill(title);
  await page.getByRole("button", { name: "创建", exact: true }).click();
  return title;
}
