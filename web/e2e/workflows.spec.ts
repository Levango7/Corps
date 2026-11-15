import { expect, test, type Page } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 工作流域：列表 + 新建/编辑弹窗（JSON 三段校验）+ 启用禁用 + 执行历史 + 手动执行 + 删除。
// 锚点逐字实证于 components/workflow/{WorkflowPageClient,WorkflowList,WorkflowEditor,WorkflowExecutionList}.tsx
// 与 app/api/v1/workspaces/[wid]/workflows/route.ts、[wfid]/route.ts、[wfid]/executions/route.ts。
// 注：工作流行操作按钮桌面态直显（hidden md:inline-flex），移动态收进 md:hidden 菜单；
// Playwright 默认视口 Desktop Chrome=1280px 走桌面态，按 class 锚定直显按钮避开双份 DOM。
async function createWorkflow(page: Page, name: string, description = ""): Promise<void> {
  await page.getByRole("button", { name: "新建工作流", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#wf-name")).toBeVisible({ timeout: 10_000 });
  await dialog.locator("#wf-name").fill(name);
  if (description) {
    await dialog.locator("#wf-desc").fill(description);
  }
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("工作流：新建校验 → 启停 → 编辑 → 执行 → 删除", () => {
  test("新建（JSON 三段校验）→ 落列表 → 禁用切换 → 编辑改名", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-wf"), "E2E工作流工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = `E2E工作流-${suffix}`;
    const desc = `E2E描述-${suffix}`;
    const name2 = `E2E工作流改-${suffix}`;

    await page.goto(`/w/${wid}/workflows`);
    await expect(page.getByRole("heading", { name: "工作流", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("暂无工作流", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "新建工作流", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // 新建模式标题（isEdit=false → workflow.create）；编辑模式为 workflow.edit
    await expect(dialog.getByRole("heading", { name: "新建工作流", exact: true })).toBeVisible();
    // 名称空 → 提交禁用（disabled={!name.trim() || submitting}）
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    // 新建模式默认模板预填（与编辑器 useEffect 初值同构）
    await expect(dialog.locator("#wf-trigger")).toHaveValue(
      JSON.stringify({ event: "task.created" }, null, 2),
    );
    // JSON 三段校验第二段：动作列表解析失败
    await dialog.locator("#wf-name").fill(name);
    await dialog.locator("#wf-actions").fill("不是json");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog.getByText("动作列表 JSON 格式无效", { exact: true })).toBeVisible();
    // 合法 JSON 但空数组 → 动作列表不能为空
    await dialog.locator("#wf-actions").fill("[]");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog.getByText("动作列表不能为空", { exact: true })).toBeVisible();
    // 恢复与默认模板同形的动作负载后提交
    await dialog.locator("#wf-actions").fill('[{"type":"notify","config":{},"order":1}]');
    await dialog.locator("#wf-desc").fill(desc);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // 列表回显：行名 + 描述 + 已启用状态 + 触发器摘要
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(desc, { exact: true })).toBeVisible();
    await expect(page.getByText("已启用", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("触发器: task.created", { exact: true })).toBeVisible();

    // 禁用：行内 Power 按钮（active 时文案=禁用）
    await page
      .locator("li")
      .filter({ hasText: name })
      .getByRole("button", { name: "禁用", exact: true })
      .click();
    // dev 首击 PATCH 路由按需编译（上一批实测 5.7s），等待窗口显式放宽
    await expect(page.getByText("已禁用", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page
        .locator("li")
        .filter({ hasText: name })
        .getByRole("button", { name: "启用", exact: true }),
    ).toBeVisible();

    // 编辑改名：桌面态直显「编辑」按钮（class 锚定，避开移动菜单同名按钮）
    await page
      .locator("li")
      .filter({ hasText: name })
      .locator('button[class*="md:inline-flex"]', { hasText: "编辑" })
      .click();
    const editDialog = page.getByRole("dialog");
    await expect(editDialog.getByRole("heading", { name: "编辑", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // 编辑模式预填旧名
    await expect(editDialog.locator("#wf-name")).toHaveValue(name);
    await editDialog.locator("#wf-name").fill(name2);
    await editDialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(name2, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });

  test("执行历史空态 → 手动触发落一行 → 删除确认", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-wf"), "E2E工作流工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = `E2E工作流执-${suffix}`;

    await page.goto(`/w/${wid}/workflows`);
    await createWorkflow(page, name);

    // 执行历史：桌面态直显按钮
    await page
      .locator("li")
      .filter({ hasText: name })
      .locator('button[class*="md:inline-flex"]', { hasText: "执行历史" })
      .click();
    const execDialog = page.getByRole("dialog");
    await expect(execDialog.getByRole("heading", { name: `${name} · 执行历史` })).toBeVisible({
      timeout: 10_000,
    });
    await expect(execDialog.getByText("暂无执行记录", { exact: true })).toBeVisible();

    // 手动执行：POST 同步执行并回查终态（executor 内部 try-catch，行必落且状态四映射之一）
    await execDialog.getByRole("button", { name: "手动执行", exact: true }).click();
    const firstRow = execDialog.locator("li").first();
    // dev 首击 POST 路由按需编译（上一批实测 5.7s），等待窗口显式放宽
    await expect(firstRow).toBeVisible({ timeout: 15_000 });
    await expect(execDialog.getByText("暂无执行记录", { exact: true })).toHaveCount(0);
    const rowText = await firstRow.innerText();
    expect(["等待中", "执行中", "已完成", "已失败"].some((s) => rowText.includes(s))).toBe(true);
    // 手动触发的 triggerData 为空对象 → 触发器行原文 {}（JSX 里冒号是 ASCII）
    expect(rowText).toContain("触发器: {}");
    // 仅此一行（GET 首拉 0 条 + 手动触发前置插入 1 条）
    await expect(execDialog.locator("li")).toHaveCount(1);

    // 关闭执行历史（aria-label=关闭 的 ✕ 按钮）
    await execDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 删除：原生 window.confirm 必须显式接收，否则 Playwright 默认 dismiss 令删除静默不发生
    page.once("dialog", (d) => d.accept());
    await page
      .locator("li")
      .filter({ hasText: name })
      .locator('button[class*="md:inline-flex"]', { hasText: "删除" })
      .click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await expect(page.getByText("暂无工作流", { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
