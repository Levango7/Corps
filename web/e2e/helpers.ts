import { type Page } from "@playwright/test";

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

  await page.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 30_000 });
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

  await page.waitForURL(/\/w\/[0-9a-f-]{36}/i, { timeout: 30_000 });
  return extractWorkspaceId(page.url());
}

/**
 * 在工作区内通过 NewTaskDialog UI 创建一条任务。
 *
 * 2026-09-27 修复：此前因 Ripple 组件 pointer-events 拦截 + useEffect 异步拉取
 * 导致 Playwright actionability check 持续超时，曾改用 API 绕过。产品代码已修复：
 *  1. Ripple 外层 span 添加 pointer-events-none，不再拦截按钮点击
 *  2. NewTaskDialog 用 aria-busy 暴露「成员/标签/里程碑列表加载中」——本 helper 显式等待
 *     其就绪再点击。注意别再靠"加载中禁用提交按钮"制造时序：请求悬挂时按钮会永久禁用。
 *
 * @returns 任务标题（供后续在看板/详情页定位）
 */
export async function createTask(page: Page, title: string): Promise<string> {
  const wid = extractWorkspaceId(page.url());
  // 点击"新建任务"按钮打开对话框
  await page.getByRole("button", { name: /新建任务|New Task/ }).click();
  // 等待对话框出现，再等内部三个列表就绪（aria-busy=false），避免点击落在异步重渲染中间
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.locator('[role="dialog"][aria-busy="false"]').waitFor({ state: "attached" });
  // 填写标题
  await page.getByLabel(/标题|Title/).fill(title);
  // 点击创建按钮（提交表单）
  await page.getByRole("button", { name: /创建|Create/ }).click();
  // 等待对话框关闭
  await page.getByRole("dialog").waitFor({ state: "detached" });
  // 导航到看板页，确保任务卡片可见（与此前 API 版本行为一致）
  await page.goto(`/w/${wid}/board`);
  return title;
}
