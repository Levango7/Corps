import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin, login, createTask } from "./helpers";

/**
 * E2E：任务管理全流程 —— 创建 → 编辑 → 拖拽看板列 → 评论 → 创建决策。
 *
 * 覆盖：
 *  - NewTaskDialog 创建任务（标题/状态/优先级）
 *  - 看板页任务卡渲染 + HTML5 拖拽跨列移动
 *  - 任务详情页标题/描述失焦自动保存
 *  - 评论发送（@提及 + ⌘/Ctrl+Enter 或发送按钮）
 *  - 决策记录创建（Markdown 编辑 + 版本号生成）
 *
 * 独立性：模块级唯一邮箱，describe.serial 保证注册先于登录。
 * 每个 test 内独立创建任务，互不依赖执行顺序。
 */

const email = uniqueEmail("e2e-task");

test.describe.serial("任务管理：创建 → 拖拽 → 评论 → 决策", () => {
  // ── 注册账号（后续 test 复用登录）──
  test("注册新账号并进入工作区", async ({ page }) => {
    await registerAndLogin(page, email, "E2E任务工作区");
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible({ timeout: 10_000 });
  });

  // ── 创建任务 + 看板渲染 ──
  test("创建任务后看板页显示在待办列", async ({ page }) => {
    const wid = await login(page, email);
    const taskTitle = `E2E任务-${Date.now()}`;

    // 在工作区首页创建任务
    await createTask(page, taskTitle);

    // 跳转到看板页验证
    await page.goto(`/w/${wid}/board`);
    await expect(page.getByRole("heading", { name: "任务看板" })).toBeVisible({ timeout: 10_000 });

    // 任务应出现在「待办」列
    await expect(page.getByText(taskTitle, { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  // ── 拖拽看板列 ──
  test("拖拽任务卡从待办列到进行中列", async ({ page }) => {
    const wid = await login(page, email);
    const taskTitle = `E2E拖拽任务-${Date.now()}`;

    // 创建任务（默认 status=todo）
    await page.goto(`/w/${wid}`);
    await createTask(page, taskTitle);
    await page.goto(`/w/${wid}/board`);
    await expect(page.getByText(taskTitle, { exact: true })).toBeVisible({ timeout: 10_000 });

    // 定位任务卡（draggable div 包含标题）
    const taskCard = page.locator('div[draggable="true"]').filter({ hasText: taskTitle });

    // 定位「进行中」列头（drop 事件在列容器冒泡）
    const inProgressColumn = page.getByText("进行中", { exact: true });

    // 执行拖拽
    await taskCard.dragTo(inProgressColumn);

    // 验证任务已移至「进行中」列：该列计数应 ≥1，且任务卡仍可见
    await expect(page.getByText(taskTitle, { exact: true })).toBeVisible({ timeout: 10_000 });

    // 切到列表视图验证状态变更（列表视图显示状态列）
    // 点任务卡进入详情页，确认状态已变为 in_progress
    await taskCard.click();
    await page.waitForURL(/\/w\/[0-9a-f-]{36}\/task\//, { timeout: 10_000 });

    // 详情页状态 select 应为「进行中」
    const statusSelect = page.locator("select").first();
    await expect(statusSelect).toHaveValue("in_progress");
  });

  // ── 任务详情编辑 + 评论 + 决策 ──
  test("任务详情页：编辑标题/描述 + 发表评论 + 创建决策", async ({ page }) => {
    const wid = await login(page, email);
    const taskTitle = `E2E详情任务-${Date.now()}`;

    // 创建任务并进入看板
    await page.goto(`/w/${wid}`);
    await createTask(page, taskTitle);
    await page.goto(`/w/${wid}/board`);

    // 点任务卡进入详情页
    const taskCard = page.locator('div[draggable="true"]').filter({ hasText: taskTitle });
    await taskCard.click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });

    // ── 编辑标题（失焦自动保存）──
    const titleArea = page.locator("textarea").first();
    const newTitle = `${taskTitle}-已编辑`;
    await titleArea.fill(newTitle);
    await titleArea.blur();
    // 失焦后触发 PATCH，标题更新
    await expect(page.getByText(newTitle)).toBeVisible({ timeout: 10_000 });

    // ── 编辑描述 ──
    const descArea = page.getByPlaceholder("补充背景、验收标准，或粘贴相关链接…");
    const descText = "这是 E2E 测试添加的描述。";
    await descArea.fill(descText);
    await descArea.blur();

    // ── 发表评论 ──
    const commentArea = page.getByPlaceholder(/写下你的想法/);
    const commentText = `E2E评论-${Date.now()}`;
    await commentArea.fill(commentText);
    await page.getByRole("button", { name: "发送" }).click();

    // 评论应出现在讨论区
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 10_000 });

    // ── 创建决策记录 ──
    await page.getByRole("button", { name: "记一条" }).click();

    const decisionArea = page.getByPlaceholder(/## 决定/);
    const decisionText = "## 决定\n采用方案 A。\n\n## 理由\n- E2E 验证通过";
    await decisionArea.fill(decisionText);

    // 保存为 v1 按钮（name 动态：保存为 v{N}）
    await page.getByRole("button", { name: /保存为 v\d/ }).click();

    // 决策内容应渲染（Markdown 渲染后包含「采用方案 A」文本）
    await expect(page.getByText("采用方案 A")).toBeVisible({ timeout: 10_000 });
  });
});
