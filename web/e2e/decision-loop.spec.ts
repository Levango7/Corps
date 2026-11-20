import { test, expect, type Page } from "@playwright/test";
import { registerAndLogin, uniqueEmail, createTask, extractWorkspaceId } from "./helpers";

/**
 * 决策闭环 E2E（#44②）：会后落位 + 决策追溯。
 *
 * 与 decisions.spec.ts 的分工：
 *  - decisions.spec.ts 钉的是「讨论 → 固化决策 → 列表可见 / 搜索 / 复盘 / 回链」
 *    里的**决策记录本身**；
 *  - 本文件钉的是产品楔子里另外三段（PRODUCT-DESIGN-2026Q4 §8.2）：
 *    A 会后落位：决策 Markdown 里的行动项**真的变成任务**，完成率面板与看板同步可见；
 *    B 决策追溯：任务详情内联决策内容 + 版本号，决策列表回链任务 ≤1 点击。
 *    这两段此前只有 lib 层集成测试，UI 接线断掉时既有用例全绿（函数正确 ≠ 被调用）。
 *    C 执行追踪面板：勾选行动项经 PATCH 落库（刷新后回读），并镜像到看板「已完成」列；
 *  - D 新人上手（示例工作区）依赖尚未立项的能力，本文件不覆盖。
 */

/** 从看板点任务卡进入详情（与 decisions.spec.ts 同款：draggable 卡片过滤 + 可见）。 */
async function openTaskDetail(page: Page, taskTitle: string): Promise<void> {
  const taskCard = page
    .locator('div[draggable="true"]')
    .filter({ hasText: taskTitle })
    .filter({ visible: true })
    .first();
  await taskCard.click();
  await page.waitForURL(/\/task\//, { timeout: 10_000 });
  // 等页面水合完成（textarea 出现说明决策编辑器区已挂载）
  await page.locator("textarea").nth(1).waitFor({ state: "visible", timeout: 30_000 });
}

/** 「记一条」→ 填 Markdown → 保存为 v{N}。 */
async function saveDecision(page: Page, markdown: string): Promise<void> {
  await page.getByRole("button", { name: "记一条" }).click();
  const decisionArea = page.locator('textarea[placeholder*="## 决定"]');
  await decisionArea.waitFor({ state: "visible", timeout: 10_000 });
  await decisionArea.fill(markdown);
  await page.getByRole("button", { name: /保存为 v\d/ }).click();
}

test.describe("决策闭环：会后落位与决策追溯", () => {
  // 本机 Windows + 冷 dev 环境注册/首屏渲染偶发 4-8s；CI Linux 更快。
  // 放宽到 120s 是为了让 waits 由断言决定（而非机器负载决定），不放宽断言本身。
  test.describe.configure({ timeout: 120_000 });

  test("会后落位：行动项变成任务（决策落地 + 看板出现两张派生任务卡）", async ({ page }) => {
    const email = uniqueEmail("loop");
    const wid = await registerAndLogin(page, email);
    const taskTitle = `会后落位母任务-${Date.now()}`;
    await createTask(page, taskTitle);
    await openTaskDetail(page, taskTitle);

    const due1 = "2026-12-20";
    const due2 = "2026-12-21";
    await saveDecision(
      page,
      [
        "## 决定",
        "采用方案 B。",
        "",
        "## 执行计划",
        `- [ ] @${email} ${due1} 采购预算复核 #high`,
        `- [ ] ${due2} 只带日期的行动项`,
      ].join("\n"),
    );

    // ── 落位第一面：决策真的保存（含行动项列表的 Markdown 渲染出来）──
    const decisionsSection = page.locator("section#decisions");
    await expect(decisionsSection.getByText("采用方案 B")).toBeVisible({ timeout: 10_000 });
    await expect(decisionsSection.getByText("采购预算复核")).toBeVisible();

    // ── 落位第二面：行动项真的建出了任务（不是只写进决策 Markdown）──
    // 这里经看板钉「任务落库」；面板勾选闭环见下方「执行追踪面板」用例。
    await page.goto(`/w/${wid}/board`);
    const card = (title: string) =>
      page
        .locator('div[draggable="true"]')
        .filter({ hasText: title })
        .filter({ visible: true })
        .first();
    await expect(card("采购预算复核")).toBeVisible({ timeout: 10_000 });
    await expect(card("只带日期的行动项")).toBeVisible();

    // 派生任务可被打开（看板 → 详情），标题落对
    await card("采购预算复核").click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });
    await expect(page.getByText("采购预算复核").first()).toBeVisible({ timeout: 10_000 });
  });

  test("决策追溯：任务详情内联决策与版本，决策列表回链任务（1 点击往返）", async ({ page }) => {
    const email = uniqueEmail("trace");
    const wid = await registerAndLogin(page, email);
    const taskTitle = `决策追溯母任务-${Date.now()}`;
    await createTask(page, taskTitle);
    await openTaskDetail(page, taskTitle);

    await saveDecision(
      page,
      ["## 决定", "采用方案 C。", "", "## 理由", "- 追溯链路验证"].join("\n"),
    );

    // ── 追溯第一面：任务详情内联决策，带版本号（从看板点卡片＝1 点击即达）──
    const decisionsSection = page.locator("section#decisions");
    await expect(decisionsSection.getByText("采用方案 C")).toBeVisible({ timeout: 10_000 });
    await expect(decisionsSection.getByText("v1", { exact: true })).toBeVisible();

    // ── 追溯第二面：决策列表 → 任务回链（1 点击回到任务详情，决策仍在）──
    await page.goto(`/w/${wid}/decisions`);
    await expect(page.getByText("采用方案 C")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: taskTitle }).click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });
    expect(extractWorkspaceId(page.url())).toBe(wid);
    await expect(page.locator("section#decisions").getByText("采用方案 C")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("执行追踪面板：勾选落库、刷新回读、看板镜像到已完成列", async ({ page }) => {
    const email = uniqueEmail("panel");
    const wid = await registerAndLogin(page, email);
    const taskTitle = `面板闭环母任务-${Date.now()}`;
    await createTask(page, taskTitle);
    await openTaskDetail(page, taskTitle);

    await saveDecision(
      page,
      [
        "## 决定",
        "采用方案 D。",
        "",
        "## 执行计划",
        "- [ ] @panel 2026-12-20 采购预算复核 #high",
        "- [ ] 2026-12-21 只带日期的行动项",
      ].join("\n"),
    );

    // ── 第一面：面板读的是 GET /action-items（#95 的读取端点）──
    // 端点缺失时面板恒显「暂无行动项」，随后所有断言都会在这里失守。
    const panel = page.locator('section[aria-label="执行追踪"]').first();
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("暂无行动项")).toHaveCount(0);
    const review = panel.getByRole("checkbox", { name: "采购预算复核" });
    const dateOnly = panel.getByRole("checkbox", { name: "只带日期的行动项" });
    await expect(review).toBeVisible({ timeout: 10_000 });
    await expect(review).not.toBeChecked();
    await expect(dateOnly).not.toBeChecked();
    await expect(panel.getByText("0/2", { exact: true })).toBeVisible();

    // ── 第二面：勾选走 PATCH，面板进度立即 1/2 ──
    await review.click();
    await expect(review).toBeChecked();
    await expect(panel.getByText("1/2", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(dateOnly).not.toBeChecked();

    // ── 第三面：刷新后仍是勾选态 —— 读的是落库结果，不是前端乐观值 ──
    await page.reload();
    const panelAfterReload = page.locator('section[aria-label="执行追踪"]').first();
    await expect(panelAfterReload.getByRole("checkbox", { name: "采购预算复核" })).toBeChecked({
      timeout: 30_000,
    });
    await expect(panelAfterReload.getByText("1/2", { exact: true })).toBeVisible();

    // ── 第四面：勾选镜像到关联任务 —— 看板卡片移到「已完成」列 ──
    await page.goto(`/w/${wid}/board`);
    const boardCard = (column: string) =>
      page
        .locator(`div[aria-label="${column}"]`)
        .locator('div[draggable="true"]')
        .filter({ hasText: "采购预算复核" })
        .filter({ visible: true })
        .first();
    await expect(boardCard("已完成")).toBeVisible({ timeout: 10_000 });
    await expect(
      page
        .locator('div[aria-label="待办"]')
        .locator('div[draggable="true"]')
        .filter({ hasText: "采购预算复核" }),
    ).toHaveCount(0);
    // 未勾选的那条仍留在待办，证明移动的是被勾选任务而非整列刷新
    await expect(
      page
        .locator('div[aria-label="待办"]')
        .locator('div[draggable="true"]')
        .filter({ hasText: "只带日期的行动项" })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  });
});
