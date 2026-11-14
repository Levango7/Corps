import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 项目模板域：新建 → 校验 → 编辑 → 分类过滤 → 应用 → 删除。
// 锚点逐字实证于 app/[locale]/w/[wid]/templates/page.tsx（组合页）、
// components/template/TemplateList.tsx、TemplateEditor.tsx、TemplateApplyDialog.tsx。
test.describe("项目模板：新建 → 编辑 → 分类过滤 → 应用 → 删除", () => {
  test("新建 → 校验 → 编辑 → 分类过滤 → 应用 → 删除", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-tpl"), "E2E模板工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tplName = `E2E模板-${suffix}`;
    const tpl2Name = `E2E模板二-${suffix}`;
    const category = `E2E分类-${suffix}`;
    const editedDesc = "E2E模板描述已更新";

    await page.goto(`/w/${wid}/templates`);
    // 空态硬锚点：EmptyState 描述文案
    await expect(page.getByText("创建一个模板，快速生成重复性任务集", { exact: true })).toBeVisible(
      { timeout: 10_000 },
    );

    // 页头「新建模板」在 DOM 上先于 EmptyState 的 action 按钮（同文案），.first() 取页头
    await page.getByRole("button", { name: "新建模板", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator("#tpl-name").fill(tplName);
    await dialog.locator("#tpl-desc").fill("E2E模板初始描述");
    await dialog.locator("#tpl-category").fill(category);
    // 公开开关：初始「私有」，点击后变「公开」且 aria-pressed=true
    await dialog.getByRole("button", { name: "私有", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "公开", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 新建模式自带一行空任务：再点一次「添加任务」凑两行；空标题提交被守卫拦截
    await dialog.getByRole("button", { name: "添加任务", exact: true }).click();
    await dialog.getByRole("button", { name: "新建模板", exact: true }).click();
    await expect(
      dialog.getByText("至少需要一个有效任务（标题非空）", { exact: true }),
    ).toBeVisible();

    // 补两行任务标题；首行优先级选「高」
    await dialog.getByLabel("任务标题 1").fill("E2E任务一");
    await dialog.getByLabel("任务标题 2").fill("E2E任务二");
    await dialog.locator("li").nth(0).locator("select").selectOption({ label: "高" });
    // 边界禁用：首行「上移」禁用、末行「下移」禁用
    await expect(
      dialog.locator("li").nth(0).getByRole("button", { name: "上移", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.locator("li").nth(1).getByRole("button", { name: "下移", exact: true }),
    ).toBeDisabled();
    // submit（新建态文本=「新建模板」）
    await dialog.getByRole("button", { name: "新建模板", exact: true }).click();

    const card = page.locator("article").filter({ hasText: tplName });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole("heading", { name: tplName, exact: true })).toBeVisible();
    await expect(card.getByText(category, { exact: true })).toBeVisible();
    await expect(card.getByText("E2E模板初始描述", { exact: true })).toBeVisible();
    await expect(card.getByText("2 个任务", { exact: true })).toBeVisible();
    // 卡片公开标记 title 借「是否公开」标签文案（projectTemplate.isPublic），如实钉现状
    await expect(card.locator('[title="是否公开"]')).toBeVisible();

    // 第二个模板：仅名称 + 一条任务（验证「无描述」「1 个任务」「私有」回显）
    await page.getByRole("button", { name: "新建模板", exact: true }).first().click();
    const dialog2 = page.getByRole("dialog");
    await expect(dialog2).toBeVisible({ timeout: 10_000 });
    await dialog2.locator("#tpl-name").fill(tpl2Name);
    await dialog2.getByLabel("任务标题 1").fill("E2E任务甲");
    await dialog2.getByRole("button", { name: "新建模板", exact: true }).click();
    await expect(page.locator("article")).toHaveCount(2);
    const card2 = page.locator("article").filter({ hasText: tpl2Name });
    await expect(card2.getByText("无描述", { exact: true })).toBeVisible();
    await expect(card2.getByText("1 个任务", { exact: true })).toBeVisible();
    await expect(card2.locator('[title="私有"]')).toBeVisible();

    // 分类过滤：列表组件的分类下拉 #tpl-category（与编辑器内同名 input 是不同元素）
    await page.locator("#tpl-category").selectOption({ label: category });
    await expect(page.locator("article")).toHaveCount(1);
    await page.locator("#tpl-category").selectOption({ label: "全部分类" });
    await expect(page.locator("article")).toHaveCount(2);

    // 编辑 card1：卡片「编辑模板」按钮（仅 title 锚定）
    await card.locator('[title="编辑模板"]').click();
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await expect(editor.locator("#tpl-name")).toHaveValue(tplName);
    await editor.locator("#tpl-desc").fill(editedDesc);
    // 编辑态 submit=「保存」
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(card.getByText(editedDesc, { exact: true })).toBeVisible({ timeout: 10_000 });

    // 应用：card1「应用」按钮（title 锚定）→ apply 对话框 → 预览 + 首 option + 成功文案
    await card.locator('[title="应用"]').click();
    const apply = page.getByRole("dialog");
    await expect(apply).toBeVisible({ timeout: 10_000 });
    await expect(apply.getByRole("heading", { name: "应用模板", exact: true })).toBeVisible();
    await expect(apply.getByText("E2E任务一", { exact: true })).toBeVisible();
    await expect(apply.getByText("E2E任务二", { exact: true })).toBeVisible();
    await expect(apply.locator("select").nth(0).locator("option").nth(0)).toHaveText(
      "未归入里程碑",
    );
    await expect(apply.locator("select").nth(1).locator("option").nth(0)).toHaveText("未指派");
    await apply.getByRole("button", { name: "应用", exact: true }).click();
    await expect(apply.getByText(/已成功创建\s*2\s*个任务/)).toBeVisible({ timeout: 10_000 });
    // 成功态 footer 左按钮文本=「关闭」；用 getByText 避开 X 按钮的同名 aria-label
    await apply.getByText("关闭", { exact: true }).click();

    // 删除：原生 window.confirm（TemplateList）。confirm 阻塞主线程，click 与 waitForEvent
    // 串行会互锁；用 page.once 预注册自动接受回调，同时截获文案核对
    let confirmMessage = "";
    page.once("dialog", (dialog) => {
      confirmMessage = dialog.message();
      dialog.accept();
    });
    await card.locator('[title="删除"]').click();
    expect(confirmMessage).toContain(tplName);
    await expect(page.locator("article").filter({ hasText: tplName })).toHaveCount(0);
    await expect(page.locator("article")).toHaveCount(1);
  });

  test("三任务输入顺序与首末行移动边界 + 顺序持久", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-tpl"), "E2E模板工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tplName = `E2E顺序模板-${suffix}`;

    await page.goto(`/w/${wid}/templates`);
    await page.getByRole("button", { name: "新建模板", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator("#tpl-name").fill(tplName);
    // 新建态自带一行空任务：再点两次「添加任务」凑三行
    await dialog.getByRole("button", { name: "添加任务", exact: true }).click();
    await dialog.getByRole("button", { name: "添加任务", exact: true }).click();
    await dialog.getByLabel("任务标题 1").fill("T1");
    await dialog.getByLabel("任务标题 2").fill("T2");
    await dialog.getByLabel("任务标题 3").fill("T3");
    // 输入顺序断言
    await expect(dialog.getByLabel("任务标题 1")).toHaveValue("T1");
    await expect(dialog.getByLabel("任务标题 2")).toHaveValue("T2");
    await expect(dialog.getByLabel("任务标题 3")).toHaveValue("T3");
    // 首末行边界禁用
    await expect(
      dialog.locator("li").nth(0).getByRole("button", { name: "上移", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.locator("li").nth(2).getByRole("button", { name: "下移", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "新建模板", exact: true }).click();
    await expect(page.locator("article").filter({ hasText: tplName })).toBeVisible({
      timeout: 10_000,
    });
    // 重开编辑器验证顺序持久（不断言交换语义，仅边界 + 顺序）
    await page
      .locator("article")
      .filter({ hasText: tplName })
      .locator('[title="编辑模板"]')
      .click();
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await expect(editor.locator("#tpl-name")).toHaveValue(tplName);
    await expect(editor.getByLabel("任务标题 1")).toHaveValue("T1");
    await expect(editor.getByLabel("任务标题 2")).toHaveValue("T2");
    await expect(editor.getByLabel("任务标题 3")).toHaveValue("T3");
  });
});
