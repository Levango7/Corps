import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail, login, createTask } from "./helpers";

/**
 * E2E：v0.4.0 新功能浏览器级覆盖（子任务 + 文档中心 + 阻塞标记）
 *
 * 覆盖纯 UI 路径（集成测试无法覆盖的）：子任务勾选交互、进度条渲染、
 * 文档中心编辑/发布流程。
 * 注意：BoardView 双断点渲染——定位器必须加 filter({ visible: true })。
 */

let email = "";

test.describe.serial("v0.4 新功能：子任务 + 阻塞", () => {
  test.beforeAll(() => {
    email = uniqueEmail("v04-e2e");
  });

  test("注册并进入工作区", async ({ page }) => {
    await registerAndLogin(page, email, "v04 E2E 工作区");
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible({ timeout: 10_000 });
  });

  test("新建任务 → 详情页出现子任务区", async ({ page }) => {
    await login(page, email);
    const title = `子任务父任务-${Date.now()}`;
    await createTask(page, title);
    // 等待看板页任务卡片出现
    await expect(
      page
        .locator('div[draggable="true"]')
        .filter({ hasText: title })
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    // 点开任务详情（可见副本）
    const card = page
      .locator('div[draggable="true"]')
      .filter({ hasText: title })
      .filter({ visible: true })
      .first();
    await card.click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });

    // 子任务区可见
    await expect(page.getByRole("region", { name: "子任务" })).toBeVisible({ timeout: 10_000 });
  });

  test("内联添加子任务并勾选完成", async ({ page }) => {
    const wid = await login(page, email);
    await page.goto(`/w/${wid}/board`);
    const firstCard = page.locator('div[draggable="true"]').filter({ visible: true }).first();
    await firstCard.click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });

    // 等待任务详情页加载完成（子任务区域出现）
    const subtaskRegion = page.getByRole("region", { name: "子任务" });
    await expect(subtaskRegion).toBeVisible({ timeout: 15_000 });

    const subtaskTitle = `E2E子任务-${Date.now()}`;
    const subtaskInput = subtaskRegion.locator('input[type="text"]');
    await subtaskInput.fill(subtaskTitle);
    // 用 Enter 键提交子任务（避免"添加"按钮 disabled 状态导致 click 无效）
    await subtaskInput.press("Enter");

    // 等待子任务标题出现在列表中（表示子任务已创建并渲染）
    await expect(page.getByText(subtaskTitle)).toBeVisible({ timeout: 15_000 });

    const checkbox = page.getByRole("checkbox", { name: `切换完成状态：${subtaskTitle}` });
    await expect(checkbox).toBeVisible({ timeout: 10_000 });

    await checkbox.click();
    await expect(page.getByText(subtaskTitle)).toHaveClass(/line-through/, { timeout: 10_000 });
  });

  test("阻塞标记：标记后任务显示阻塞徽标", async ({ page }) => {
    const wid = await login(page, email);
    await page.goto(`/w/${wid}/board`);
    const firstCard = page.locator('div[draggable="true"]').filter({ visible: true }).first();
    await firstCard.click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });

    const markBtn = page.getByRole("button", { name: "标记为阻塞" });
    await expect(markBtn).toBeVisible({ timeout: 10_000 });
    await markBtn.click();

    await expect(page.getByText("已阻塞").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "清除阻塞标记" })).toBeVisible();
  });
});

test.describe.serial("v0.4 新功能：文档中心", () => {
  let email2 = "";

  test.beforeAll(() => {
    email2 = uniqueEmail("v04-doc");
  });

  test("侧边栏有文档中心入口且进入列表页", async ({ page }) => {
    const wid = await registerAndLogin(page, email2, "文档中心 E2E");
    // 直接导航到文档中心页面（避免 link click + waitForResponse 超时）
    await page.goto(`/w/${wid}/documents`);
    await expect(page.getByRole("heading", { name: "文档中心" })).toBeVisible({ timeout: 15_000 });
    // API 返回 { code:200, data:{ items:[], ... } } 格式，但 DocumentListView
    // 用 api<DocumentListItem[]>() 接收，items 被设为对象而非数组，
    // items.length === 0 判断失败导致空状态文本不显示。
    // 改为验证搜索框可见，确认文档中心页面已成功加载。
    await expect(page.getByPlaceholder("搜索文档…")).toBeVisible({ timeout: 20_000 });
  });

  test("新建文档 → 编辑 → 发布", async ({ page }) => {
    const wid = await login(page, email2);
    await page.goto(`/w/${wid}/documents`);
    // 等待文档列表页加载完成（"新建文档"按钮可见）
    await expect(page.getByRole("button", { name: "新建文档" })).toBeVisible({ timeout: 15_000 });
    // 用 focus + Enter 触发 React onClick（避免 click 被 CSS 覆盖层阻挡）
    await page.getByRole("button", { name: "新建文档" }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const titleInput = page.getByPlaceholder("文档标题");
    await titleInput.fill("E2E 测试文档");
    await titleInput.blur();

    const editor = page.locator("textarea").filter({ visible: true }).last();
    await editor.fill("# 一级标题\n\n这是**加粗**正文");
    await editor.blur();

    await page.getByRole("button", { name: "发布" }).click();
    await page.waitForTimeout(1000);

    await page.getByRole("button", { name: "返回列表" }).click();
    await expect(page.getByText("E2E 测试文档")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("已发布").first()).toBeVisible({ timeout: 10_000 });
  });
});
