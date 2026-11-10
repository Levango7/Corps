import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin } from "./helpers";

/**
 * E2E：多维表格域交互 —— 内联创建 → 跳详情页渲染 / 空态与列表卡片。
 *
 * 覆盖 route-health 抓不到的东西：
 *  - DatabaseList 的内联新建表单（不是 dialog）：点「新建多维表格」后 form 出现在页面上，
 *    提交按钮文案「创建」与页面级按钮「新建多维表格」不同名，列表页内唯一
 *  - 创建连带补默认字段 + 默认表格视图后 router.push 进详情页（与表单域留列表不同）
 *  - DatabaseEditor 详情页：h1 渲染库标题、视图切换 tablist、记录数「0 条」
 *  - 列表空态「还没有多维表格」与创建后卡片出现（标题文本定位，不用卡片序号）
 *
 * 断言口径：
 *  - 新注册用户即 owner，canManage 为真，列表页渲染新建/删除按钮
 *  - 列表项用标题文本定位，不用卡片序号（列表顺序受其它实例影响）
 */

test.describe("多维表格：内联创建 → 详情页渲染 / 空态与列表卡片", () => {
  test("新建多维表格：内联表单提交后跳详情页，标题与视图切换渲染", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-database"), "E2E多维表格工作区");
    const title = `E2E需求池-${Date.now()}`;

    await page.goto(`/w/${wid}/databases`);
    await expect(page.getByRole("button", { name: "新建多维表格" })).toBeVisible({
      timeout: 10_000,
    });

    // 点「新建多维表格」展开内联表单（非 dialog），填名称后提交
    await page.getByRole("button", { name: "新建多维表格" }).first().click();
    await page.getByLabel("名称").fill(title);
    await page.getByRole("button", { name: "创建", exact: true }).click();

    // 创建成功 → 连带补默认字段/视图后跳详情页
    await expect(page).toHaveURL(/\/databases\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tablist", { name: "视图切换" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("0 条", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("列表空态与创建后卡片出现：回列表后新库出现在卡片网格", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-database"), "E2E多维表格工作区");
    const title = `E2E排期表-${Date.now()}`;

    await page.goto(`/w/${wid}/databases`);
    // 新工作区无库：空态文案可见（items 判空口径曾在 v04 注释里出过 bug，这里钉住）
    await expect(page.getByText("还没有多维表格", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "新建多维表格" }).first().click();
    await page.getByLabel("名称").fill(title);
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page).toHaveURL(/\/databases\/[^/]+$/, { timeout: 15_000 });

    // 回列表页：新库卡片出现，标题文本 + 打开链接 aria-label 双口径
    await page.goto(`/w/${wid}/databases`);
    await expect(
      page.getByText(title, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: `打开 ${title}` })).toBeVisible({
      timeout: 10_000,
    });
  });
});
