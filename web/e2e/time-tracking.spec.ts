import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail, createTask } from "./helpers";

/**
 * E2E：工时记录域 —— 开始计时 → 停止 → 列表渲染 → 行内编辑 → 删除 → 报告 tab。
 *
 * 覆盖：
 *  - 计时器表单：关联任务 select / 描述 / 计费切换（aria-pressed）/ 时薪
 *  - 开始计时 → running 徽标「进行中」+ 停止按钮 + 表单隐藏
 *  - 停止后列表出现该条（时长 HH:MM:SS / 描述 / 计费徽标，均在行容器内断言避撞）
 *  - 行内编辑（EditRow：改描述 → 保存 → 旧描述消失）
 *  - 删除（window.confirm accept）→ 空态 noEntries
 *  - 报告 tab：日期筛选 + 分组 select（切到任务分组）+ 分组表格（表头 + 至少一行）
 *
 * 前置：dev server + RATE_LIMIT_DISABLED=1 + 库可达（同其他 spec）。
 * 独立性：每个 test 自带账号夹具（注册即登录）并独立建任务，互不依赖
 * 执行顺序——所以不用 describe.serial：serial 下首条红会把整组后续用例
 * 标成 skipped，覆盖悄悄缩水，报告里只看得到第一条红。
 */

test.describe("工时记录：开始 → 停止 → 列表编辑删除 → 报告", () => {
  test("计时器开始/停止 + 列表行内编辑/删除", async ({ page }) => {
    // 计时 + 列表 + 编辑 + 删除多段串联，放宽总超时
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-time"), "E2E工时工作区");
    const taskTitle = `E2E工时任务-${Date.now()}`;
    const desc = `E2E工时描述-${Date.now()}`;
    const descEdited = `${desc}-已改`;

    await createTask(page, taskTitle);
    await page.goto(`/w/${wid}/time-tracking`);

    // ── 计时器表单：关联任务 + 描述 + 计费 + 时薪 ──
    await expect(page.getByRole("button", { name: "开始", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("combobox").selectOption({ label: taskTitle });
    await page.locator('input[type="text"]').fill(desc);
    await page.getByRole("button", { name: "计费", exact: true }).click();
    await expect(page.getByRole("button", { name: "计费", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByPlaceholder("0.00").fill("100");

    // ── 开始计时：running 徽标 + 停止按钮 + 表单隐藏 ──
    await page.getByRole("button", { name: "开始", exact: true }).click();
    await expect(page.getByText("进行中", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('input[type="text"]')).toBeHidden({ timeout: 10_000 });

    // ── 停止计时：表单回来 + 列表出现该条（行容器内断言，避开表单区同名文本）──
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(page.locator('input[type="text"]')).toBeVisible({ timeout: 10_000 });
    const row = page.locator("ul li").first();
    await expect(row.getByText(desc, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("计费", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeVisible({ timeout: 10_000 });

    // ── 行内编辑：改描述 → 保存 → 旧描述消失 ──
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await row.locator('input[type="text"]').fill(descEdited);
    await row.getByRole("button", { name: "保存", exact: true }).click();
    await expect(row.getByText(descEdited, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(desc, { exact: true })).not.toBeVisible();

    // ── 删除该条（window.confirm accept）→ 空态 ──
    page.once("dialog", (dialog) => dialog.accept());
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByText("暂无工时记录")).toBeVisible({ timeout: 10_000 });
  });

  test("报告 tab：日期筛选 + 分组切换 + 汇总卡与表格", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-time-report"), "E2E工时工作区");
    const taskTitle = `E2E报告任务-${Date.now()}`;
    const desc = `E2E报告描述-${Date.now()}`;

    // 造一条已停止的工时记录（开始 → 立即停止）
    await createTask(page, taskTitle);
    await page.goto(`/w/${wid}/time-tracking`);
    await page.getByRole("combobox").selectOption({ label: taskTitle });
    await page.locator('input[type="text"]').fill(desc);
    await page.getByRole("button", { name: "开始", exact: true }).click();
    await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(page.locator("ul li").first().getByText(desc, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // ── 报告 tab ──
    await page.getByRole("button", { name: "报告", exact: true }).click();
    // TimeReport 挂载硬证据：日期筛选 input（页面唯一 type=date）
    await expect(page.locator('input[type="date"]').first()).toBeVisible({ timeout: 10_000 });
    // 分组 select：按 option 的硬编码 value 过滤定位（TimeTracker 的任务 select
    // 同在页面且 option 文案含「任务」二字，按文本匹配会撞；value="task" 是
    // 组件字面量，不随翻译变化）
    const groupSelect = page
      .locator("select")
      .filter({ has: page.locator('option[value="task"]') });
    await expect(groupSelect).toBeVisible({ timeout: 10_000 });
    await groupSelect.selectOption({ value: "task" });
    // 分组表格：表头 + 至少一行（该任务）——tbody 存在即报告 API 返回了分组数据
    await expect(page.getByRole("columnheader", { name: "分组" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 10_000 });
  });
});
