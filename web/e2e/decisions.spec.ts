import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail, createTask } from "./helpers";

/**
 * E2E：决策记录域 —— 任务讨论 → 固化为决策 → 决策列表 → 搜索 → 复盘标记 → 回链。
 *
 * 覆盖：
 *  - 任务详情评论区发表讨论（讨论段定位：section + heading「讨论」内 textarea）
 *  - 「记一条」编辑器固化决策（Markdown 正文 + 保存为 v{N} 版本号）
 *  - /decisions 列表渲染（任务标题回链 + v{N} 版本 badge + Markdown 正文）
 *  - 搜索命中（debounce 300ms + 服务端 q 过滤）
 *  - 复盘标记双向切换（标记已复盘 ↔ 撤销复盘，aria-pressed + 按钮文案翻转）
 *  - AI 提炼对话框：打开 + 短输入客户端校验（<10 字 → 提炼按钮禁用）+ 关闭
 *    （不触发 POST extract：CI 环境无 AI 后端，端点必挂，只钉客户端行为）
 *  - 空态与搜索无结果态（emptyHint / noResultsMatch / 清空搜索恢复）
 *
 * 前置：dev server + RATE_LIMIT_DISABLED=1 + 库可达（同其他 spec）。
 * 独立性：每个 test 自带账号夹具（注册即登录）并独立建任务，
 * 互不依赖执行顺序——所以不用 describe.serial：serial 下首条红会把整组
 * 后续用例标成 skipped，覆盖悄悄缩水，报告里只看得到第一条红。
 */

test.describe("决策记录：讨论 → 固化 → 列表 → 复盘 → 回链", () => {
  test("任务详情讨论后固化决策，decisions 列表可见、搜索命中、可复盘、可回链", async ({ page }) => {
    // 评论 + 决策固化 + 列表 + 搜索 + 复盘 + 回链多段串联，放宽总超时
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-decisions"), "E2E决策工作区");
    const taskTitle = `E2E决策任务-${Date.now()}`;

    // 建任务并进入详情（讨论与决策都发生在任务详情页）
    await createTask(page, taskTitle);
    const taskCard = page
      .locator('div[draggable="true"]')
      .filter({ hasText: taskTitle })
      .filter({ visible: true })
      .first();
    await taskCard.click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });
    await page.locator("textarea").nth(1).waitFor({ state: "visible", timeout: 30_000 });

    // ── 讨论段：发表评论 ──
    // 通过「讨论」标题定位评论区 section，再在 section 内找 textarea
    // （不用 placeholder 定位——CI production build 中 next-intl 客户端导航
    // 翻译消息加载时序可能导致 placeholder 暂不匹配）
    const commentText = `E2E评论-${Date.now()}`;
    const commentSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "讨论" }),
    });
    await commentSection.locator("textarea").first().fill(commentText);
    // exact：页面同时有聊天「发送聊天消息」按钮，前缀匹配会撞车
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 10_000 });

    // ── 固化段：「记一条」编辑器保存为 v1 ──
    await page.getByRole("button", { name: "记一条" }).click();
    const decisionArea = page.locator('textarea[placeholder*="## 决定"]');
    await decisionArea.waitFor({ state: "visible", timeout: 10_000 });
    const decisionText = "## 决定\n采用方案 A。\n\n## 理由\n- E2E 验证通过";
    await decisionArea.fill(decisionText);
    await page.getByRole("button", { name: /保存为 v\d/ }).click();
    await expect(page.getByText("采用方案 A")).toBeVisible({ timeout: 10_000 });

    // ── 列表段：decisions 页出现该条，任务标题为回链 ──
    await page.goto(`/w/${wid}/decisions`);
    await expect(page.getByRole("link", { name: taskTitle })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("采用方案 A")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("v1", { exact: true })).toBeVisible({ timeout: 10_000 });

    // ── 搜索命中（debounce 300ms，expect 轮询等请求返回）──
    await page.getByPlaceholder("搜索决策内容…").fill("方案");
    await expect(page.getByRole("link", { name: taskTitle })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("采用方案 A")).toBeVisible({ timeout: 10_000 });

    // ── 复盘标记双向切换（aria-pressed + 按钮文案翻转）──
    const reviewBtn = page.getByRole("button", { name: "标记已复盘" });
    await expect(reviewBtn).toBeVisible({ timeout: 10_000 });
    await reviewBtn.click();
    await expect(page.getByText("已复盘", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "撤销复盘" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "撤销复盘" }).click();
    await expect(page.getByRole("button", { name: "标记已复盘" })).toBeVisible({ timeout: 10_000 });

    // ── 回链段：点任务标题跳回任务详情，决策与讨论都在 ──
    await page.getByRole("link", { name: taskTitle }).click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });
    await expect(page.getByText("采用方案 A")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 10_000 });
  });

  test("decisions 页：AI 提炼对话框短输入客户端校验（不触发请求）", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-decisions-ai"), "E2E决策工作区");
    await page.goto(`/w/${wid}/decisions`);

    // 打开 AI 对话框
    await expect(page.getByRole("button", { name: "AI 提炼", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "AI 提炼", exact: true }).click();
    await expect(page.getByText("AI 决策提炼")).toBeVisible({ timeout: 10_000 });

    // 短输入：提炼按钮被客户端禁用（handleExtract 内 aiSourceTooShort 校验只在
    // 点击时触发，而按钮 disabled=aiBusy||trim<10 根本点不到——故只钉 disabled
    // 与关闭，不断言报错文案，避免把实现细节写进测试）
    await page
      .getByPlaceholder(
        "把讨论记录粘贴到这里。AI 会提炼标题和关键结论，生成可编辑的 markdown 草稿。",
      )
      .fill("太短");
    await expect(page.getByRole("button", { name: "提炼", exact: true })).toBeDisabled({
      timeout: 10_000,
    });

    // 关闭对话框（全程不发送 POST extract：CI 无 AI 后端，端点必挂）
    // dialog 内 X 图标按钮（仅 aria-label=关闭）与页脚文本按钮都叫「关闭」，
    // hasText 过滤只留带文本的页脚按钮（decisions/page.tsx 实测 markup）
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .filter({ hasText: "关闭" })
      .click();
    await expect(page.getByText("AI 决策提炼")).not.toBeVisible({ timeout: 10_000 });
  });

  test("decisions 页：空态与搜索无结果态", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-decisions-empty"), "E2E决策工作区");
    await page.goto(`/w/${wid}/decisions`);

    // 空态（新工作区尚无任何决策记录）
    await expect(page.getByText("在任务详情中记录决策后，会在这里展示")).toBeVisible({
      timeout: 10_000,
    });

    // 搜索无结果态
    await page.getByPlaceholder("搜索决策内容…").fill("不存在的关键词xyz");
    await expect(page.getByText("没有找到匹配的决策记录")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("换个关键词试试")).toBeVisible({ timeout: 10_000 });

    // 清空搜索恢复空态
    await page.getByRole("button", { name: "清空搜索", exact: true }).click();
    await expect(page.getByText("在任务详情中记录决策后，会在这里展示")).toBeVisible({
      timeout: 10_000,
    });
  });
});
