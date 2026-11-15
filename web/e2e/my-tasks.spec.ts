import { expect, test } from "@playwright/test";
import { createTask, registerAndLogin, uniqueEmail } from "./helpers";

// 我的任务域：assignee=me 列表 + 状态分组 + 状态筛选（aria-pressed）+ 三键排序 + 点卡进详情。
// 锚点逐字实证于 app/[locale]/w/[wid]/my-tasks/page.tsx、lib/task-meta.ts（STATUS_FILTERS/COLUMNS）
// 与 components/NewTaskDialog.tsx（夹具造数据：状态/优先级/负责人/截止日期全走 UI）。
function localISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localISO(d);
}

test.describe("我的任务：分组 + 状态筛选 + 排序 + 点卡进详情", () => {
  test("空态 → 建任务指派给自己 → 待办组呈现 + 点卡进详情", async ({ page }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail("e2e-mytask");
    // 注册未传 name → 服务端默认 name = 邮箱 @ 前本地部分（register route.ts:52），
    // 指派人下拉选项显示 name（NewTaskDialog 取 m.name || m.email），故夹具传本地部分
    const displayName = email.split("@")[0];
    const wid = await registerAndLogin(page, email, "E2E我的任务工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = `E2E我的任务-${suffix}`;

    await page.goto(`/w/${wid}/my-tasks`);
    await expect(page.getByRole("heading", { name: "我的任务", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // 空态（EmptyState inbox）：这个工作区还没有任务。+ 还没有任务分配给你，去看板认领一个吧。
    await expect(page.getByText("这个工作区还没有任务。", { exact: true })).toBeVisible();
    await expect(
      page.getByText("还没有任务分配给你，去看板认领一个吧。", { exact: true }),
    ).toBeVisible();
    // 计数副标题：共 0 个任务（tasks.length 全量口径，不随筛选变）
    await expect(page.getByText("共 0 个任务", { exact: true })).toBeVisible();

    // 夹具：看板 UI 建任务，指派给自己 + 高优先级 + 明天截止
    await createTask(page, title, {
      assigneeLabel: displayName,
      priority: "high",
      dueDate: plusDays(1),
    });

    await page.goto(`/w/${wid}/my-tasks`);
    // 待办分组呈现：组头（状态点+名+计数徽章 1）+ 卡片（标题/待办徽章/高优先级色条）
    const section = page.locator("section").filter({ hasText: "待办" });
    await expect(section.getByText(title, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(section.getByText("1", { exact: true })).toBeVisible();
    const card = section.locator("a").filter({ hasText: title });
    await expect(card.getByText("待办", { exact: true })).toBeVisible();
    // 优先级色条：内联 style 4px 色条走 PRIORITY_BAR_COLORS（high=var(--prio-high-fg)）
    await expect(card).toHaveAttribute("style", /var\(--prio-high-fg\)/);
    // 计数副标题同步
    await expect(page.getByText("共 1 个任务", { exact: true })).toBeVisible();

    // 点卡进详情（TaskCard 整卡 Link → /task/:id）
    await card.click();
    await page.waitForURL(/\/task\//, { timeout: 10_000 });
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("状态筛选（单组/空组无结果）+ 最近更新/截止日期/优先级三排序", async ({ page }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail("e2e-mytask");
    // 同 test1：指派人下拉显示 name（注册默认 = 邮箱本地部分，register route.ts:52）
    const displayName = email.split("@")[0];
    const wid = await registerAndLogin(page, email, "E2E我的任务工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 同组三任务，优先级/截止日期/创建次序三者错开，使三种排序结果互不相同；另建进行中任务供筛选演示
    const titleX = `E2E排序甲-${suffix}`; // todo/low/截止+1（第 1 个建）
    const titleY = `E2E排序乙-${suffix}`; // todo/high/截止+2（第 2 个建）
    const titleZ = `E2E排序丙-${suffix}`; // todo/medium/截止+3（第 3 个建）
    const titleW = `E2E排序丁-${suffix}`; // in_progress/urgent（第 4 个建）

    await createTask(page, titleX, {
      status: "todo",
      priority: "low",
      dueDate: plusDays(1),
      assigneeLabel: displayName,
    });
    await createTask(page, titleY, {
      status: "todo",
      priority: "high",
      dueDate: plusDays(2),
      assigneeLabel: displayName,
    });
    await createTask(page, titleZ, {
      status: "todo",
      priority: "medium",
      dueDate: plusDays(3),
      assigneeLabel: displayName,
    });
    await createTask(page, titleW, {
      status: "in_progress",
      priority: "urgent",
      dueDate: plusDays(5),
      assigneeLabel: displayName,
    });

    await page.goto(`/w/${wid}/my-tasks`);
    await expect(page.getByText("共 4 个任务", { exact: true })).toBeVisible({ timeout: 10_000 });
    // 全部模式下跳过空组：待办/进行中两组在，评审/已完成两组缺席（本批无 review/done 任务）
    for (const g of ["待办", "进行中"]) {
      await expect(page.locator("section").filter({ hasText: g })).toBeVisible();
    }
    for (const g of ["评审", "已完成"]) {
      await expect(page.locator("section").filter({ hasText: g })).toHaveCount(0);
    }

    // 单状态筛选：进行中 → 仅丁卡在位，甲乙丙出 DOM
    await page.getByRole("button", { name: "进行中", exact: true }).click();
    await expect(page.getByText(titleW, { exact: true })).toBeVisible();
    await expect(page.getByText(titleX, { exact: true })).toHaveCount(0);
    await expect(page.getByText(titleY, { exact: true })).toHaveCount(0);
    await expect(page.getByText(titleZ, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "进行中", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 筛到空组走另一空态（有任务但当前筛选无匹配）：没有匹配的任务
    await page.getByRole("button", { name: "已完成", exact: true }).click();
    await expect(page.getByText("没有匹配的任务", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // 计数副标题不随筛选变（tasks.length 全量口径）
    await expect(page.getByText("共 4 个任务", { exact: true })).toBeVisible();

    // 回全部，四卡齐
    await page.getByRole("button", { name: "全部", exact: true }).click();
    for (const t of [titleX, titleY, titleZ, titleW]) {
      await expect(page.getByText(t, { exact: true })).toBeVisible();
    }

    // 排序：原生 select（aria-label=排序方式），值 recent/due/priority；
    // 组间顺序恒为状态序（todo→in_progress→review→done），排序只作用于组内
    const sort = page.getByLabel("排序方式");
    // span.truncate 全页有多处（侧栏导航标签也是），必须限定在状态组 section 内取卡标题
    const titles = () => page.locator("section span.truncate").allTextContents();
    await sort.selectOption({ label: "最近更新" });
    await expect.poll(titles).toEqual([titleZ, titleY, titleX, titleW]); // updatedAt 倒序：丁最新
    await sort.selectOption({ label: "截止日期" });
    // due 升序：甲+1/乙+2/丙+3；丁虽 due+5 但属进行中组，组间恒状态序垫底
    await expect.poll(titles).toEqual([titleX, titleY, titleZ, titleW]);
    await sort.selectOption({ label: "优先级" });
    await expect.poll(titles).toEqual([titleY, titleZ, titleX, titleW]); // urgent>high>medium>low
  });
});
