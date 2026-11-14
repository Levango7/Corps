import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

// 公告域：发布 → 展开已读（localStorage 持久）→ 类型过滤 → 编辑 → 取消置顶 → 删除。
// 锚点逐字实证于 app/[locale]/w/[wid]/announcements/page.tsx（列表 + 内联 ConfirmDialog）
// 与 components/announcement/AnnouncementEditor.tsx。
test.describe("公告：发布 → 展开已读 → 过滤 → 编辑 → 取消置顶 → 删除", () => {
  test("发布 → 展开已读 → 类型过滤 → 取消置顶 → 编辑 → 删除", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-announce"), "E2E公告工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = `E2E公告-${suffix}`;
    const editedTitle = `E2E公告改-${suffix}`;
    const bodyText = `E2E公告正文-${suffix}`;

    await page.goto(`/w/${wid}/announcements`);
    // 空态硬锚点：emptyHint 只在「非 loading 且零公告」渲染（loading 态显「暂无公告」占位）
    await expect(page.getByText("点击「新建公告」发布第一条", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // 页头「新建公告」（dialog 未开时全页唯一；编辑器新建态 submit 同文案，须 dialog 域内点）
    await page.getByRole("button", { name: "新建公告", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // 渐进守卫：标题空 → submit 禁用；只填标题仍禁用（内容也空）
    await expect(dialog.getByRole("button", { name: "新建公告", exact: true })).toBeDisabled();
    // 标题/内容用硬 id 锚定：label 文本走 announcement.title=「公告」，与页头撞名
    await dialog.locator("#ann-title").fill(title);
    await expect(dialog.getByRole("button", { name: "新建公告", exact: true })).toBeDisabled();
    await dialog.locator("#ann-content").fill(bodyText);
    // 类型 = dialog 内第一个 select（受众 select 在其后）；选「紧急」
    await dialog.locator("select").nth(0).selectOption({ label: "紧急" });
    // 置顶开关：未置顶态文本「未置顶」（编辑器语义 pinned=false 显 unpin 文案）。
    // 该开关被 label 包裹且无 aria-label，accessible name 为空（页面快照实证），按文本点
    await dialog.getByText("未置顶", { exact: true }).click();
    // 过期时间 date input（aria-label=「过期时间」）；不断言日期值，只断言标签存在
    await dialog.getByLabel("过期时间").fill("2027-12-31");
    await dialog.getByRole("button", { name: "新建公告", exact: true }).click();

    // 列表条目锚定：li 内含标题按钮
    const item = page
      .locator("li")
      .filter({ has: page.getByRole("button", { name: title, exact: true }) });
    await expect(item).toBeVisible({ timeout: 10_000 });
    await expect(item.getByText("紧急", { exact: true })).toBeVisible();
    await expect(item.getByText("置顶", { exact: true })).toBeVisible();
    await expect(item.getByText("未读", { exact: true })).toBeVisible();
    await expect(item.getByText("过期时间", { exact: false })).toBeVisible();

    // 展开：点标题按钮 → 全文 + 已读徽标（展开自动标记已读）
    await item.getByRole("button", { name: title, exact: true }).click();
    await expect(item.getByText(bodyText, { exact: true })).toBeVisible();
    await expect(item.getByText("已读", { exact: true })).toBeVisible();
    await expect(item.getByText("未读", { exact: true })).toHaveCount(0);

    // 类型过滤：点「通知」→ 紧急条目消失（chip 是 page 级 button，与 li 徽标 span 不撞）。
    // 过滤为空时 items.length=0 致统计栏与 chip 栏整体卸载、「紧急」chip 不可点——产品现状，
    // 不强行点回；过滤态由下方 reload 重置
    await page.getByRole("button", { name: "通知", exact: true }).click();
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);

    // 持久化硬证据：重载后标题与已读徽标仍在（已读走 localStorage）
    await page.reload();
    const item2 = page
      .locator("li")
      .filter({ has: page.getByRole("button", { name: title, exact: true }) });
    await expect(item2.getByRole("button", { name: title, exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(item2.getByText("已读", { exact: true })).toBeVisible();

    // 取消置顶：列表切换按钮 aria-label=pinned ? 未置顶 : 置顶（动作语义，与编辑器状态语义相反）
    await item2.getByRole("button", { name: "未置顶", exact: true }).click();
    // dev 首击 PATCH 路由触发按需编译，实测 5.7s（ dev server 日志实证），超过 expect 默认 5s → 显式放宽
    await expect(item2.getByRole("button", { name: "置顶", exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(item2.getByText("置顶", { exact: true })).toHaveCount(0);

    // 编辑：li 内「编辑」按钮（aria-label）→ 编辑器编辑态（h2=「编辑」）→ 改标题 → submit=「发布」
    await item2.getByRole("button", { name: "编辑", exact: true }).click();
    const editor = page.getByRole("dialog");
    await expect(editor).toBeVisible({ timeout: 10_000 });
    await editor.locator("#ann-title").fill(editedTitle);
    await editor.getByRole("button", { name: "发布", exact: true }).click();
    await expect(page.getByRole("button", { name: editedTitle, exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);

    // 删除：li 内「删除」按钮 → 自定义 ConfirmDialog（正文「确定删除此公告？此操作不可撤销。」）
    const item3 = page
      .locator("li")
      .filter({ has: page.getByRole("button", { name: editedTitle, exact: true }) });
    await item3.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByText("确定删除此公告？此操作不可撤销。", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // ConfirmDialog 的 danger 按钮文本=button 域「删除」；dialog 域内点，避开底层 li 同名按钮
    await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByRole("button", { name: editedTitle, exact: true })).toHaveCount(0);
  });

  test("两条未读 → 全部标记已读 → 搜索过滤", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-announce"), "E2E公告工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const titles = [`E2E公告甲-${suffix}`, `E2E公告乙-${suffix}`];

    await page.goto(`/w/${wid}/announcements`);
    for (const t of titles) {
      await page.getByRole("button", { name: "新建公告", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      // 同上：label 文本是「公告」，用硬 id 锚定
      await dialog.locator("#ann-title").fill(t);
      await dialog.locator("#ann-content").fill(`正文-${t}`);
      await dialog.getByRole("button", { name: "新建公告", exact: true }).click();
      await expect(page.getByRole("button", { name: t, exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }
    // 已读/未读徽标断言收进 li 作用域：统计栏也有同文案（statsRead/statsUnread）
    await expect(page.locator("li").getByText("未读", { exact: true })).toHaveCount(2);
    // 全部标记已读（stats.unread>0 才渲染）
    await page.getByRole("button", { name: "全部标记已读", exact: true }).click();
    await expect(page.locator("li").getByText("已读", { exact: true })).toHaveCount(2);
    await expect(page.locator("li").getByText("未读", { exact: true })).toHaveCount(0);
    // 持久化硬证据
    await page.reload();
    await expect(page.locator("li").getByText("已读", { exact: true })).toHaveCount(2);
    // 搜索：本地过滤标题+摘要
    await page.getByPlaceholder("搜索公告…").fill(titles[0]);
    await expect(page.getByRole("button", { name: titles[1], exact: true })).toHaveCount(0);
    await page.getByPlaceholder("搜索公告…").fill("");
    await expect(page.getByRole("button", { name: titles[1], exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
