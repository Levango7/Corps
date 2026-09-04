import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail, login } from "./helpers";

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
    const wid = await login(page, email);
    await page.goto(`/w/${wid}/board`);
    await page.getByRole("button", { name: "新建任务" }).first().click();
    const title = `子任务父任务-${Date.now()}`;
    await page.getByPlaceholder("一句话说清要做什么").fill(title);
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await page.waitForTimeout(1500);

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

    const subtaskTitle = `E2E子任务-${Date.now()}`;
    await page.getByPlaceholder("添加子任务…").fill(subtaskTitle);
    await page.getByRole("button", { name: "添加", exact: true }).click();
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
    await registerAndLogin(page, email2, "文档中心 E2E");
    await page.getByRole("link", { name: "文档中心" }).first().click();
    await expect(page.getByRole("heading", { name: "文档中心" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("还没有文档")).toBeVisible({ timeout: 10_000 });
  });

  test("新建文档 → 编辑 → 发布", async ({ page }) => {
    const wid = await login(page, email2);
    await page.goto(`/w/${wid}/documents`);
    await page.getByRole("button", { name: "新建文档" }).click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 10_000 });

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
