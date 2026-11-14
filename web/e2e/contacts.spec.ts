import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail, waitForContactGroupsLoaded } from "./helpers";

// 联系人域：分组（侧栏）+ 通讯录 CRUD（列表 + 详情侧栏）。
// 锚点逐字实证于 components/contact/ContactGroupSidebar.tsx、ContactList.tsx、
// ContactDetail.tsx 与 app/[locale]/w/[wid]/contacts/page.tsx（内联 CreateContactDialog）。
test.describe("联系人：分组 + 通讯录 CRUD", () => {
  test("联系人建改存删全链路 + 分组关联回显", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-contact"), "E2E联系人工作区");
    // 防撞后缀：分组名 / 联系人名 / 邮箱均带唯一段，避免与存量行撞唯一约束
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const groupName = `E2E分组-${suffix}`;
    const contactName = `E2E联系人-${suffix}`;
    const email = `c-${suffix}@e2e.local`;
    const phone = "13800000001";
    const newPhone = "13900000002";
    const dept = "E2E部门";
    const pos = "E2E职位";
    const notes = `E2E备注-${suffix}`;

    await page.goto(`/w/${wid}/contacts`);
    // 等侧栏首拉落地再建组：挂载 GET 慢于建组响应时会覆盖乐观 append（实测 flaky 根因）
    await waitForContactGroupsLoaded(page);
    // 空态硬锚点：列表「暂无联系人」
    await expect(page.getByText("暂无联系人", { exact: true })).toBeVisible({ timeout: 10_000 });

    // 建分组：侧栏「新建分组」按钮（aria-label）→ 输入「分组名称」→ Enter 提交。
    // 不点提交按钮：其 aria-label 是 contact 域的「新建联系人」，与页头按钮撞名。
    await page.getByRole("button", { name: "新建分组", exact: true }).click();
    await page.getByPlaceholder("分组名称").fill(groupName);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: groupName, exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // 新建联系人：页头按钮文本「新建联系人」（dialog 未开时全页唯一）
    await page.getByRole("button", { name: "新建联系人", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("姓名").fill(contactName);
    await dialog.getByLabel("邮箱").fill(email);
    await dialog.getByLabel("电话").fill(phone);
    await dialog.getByLabel("部门").fill(dept);
    await dialog.getByLabel("职位").fill(pos);
    await dialog.getByLabel("备注").fill(notes);
    // 分组选项异步加载，等 select 的文本内容含组名再选，避免竞态（不依赖 option 可见性）
    await expect(dialog.locator("#cc-group")).toContainText(groupName);
    await dialog.locator("#cc-group").selectOption({ label: groupName });
    // submit 文本是 button 域的「创建」（与页头「新建联系人」不同源，须 dialog 域内点）
    await dialog.getByRole("button", { name: "创建", exact: true }).click();

    // 详情侧栏锚点：ContactDetail 根 aside 带 border-l（分组侧栏 aside 带 border-r，可精确区分）
    const detail = page.locator("aside.border-l");
    // 详情头 h2 与详情体 h3 同显联系人名，page 级会双命中，用 level:3 钉死
    await expect(
      page.getByRole("heading", { name: contactName, level: 3, exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    // 列表行也含同文案，以下回显断言全部收进 detail 作用域
    await expect(detail.getByText(email, { exact: true })).toBeVisible();
    await expect(detail.getByText(phone, { exact: true })).toBeVisible();
    await expect(detail.getByText(dept, { exact: true })).toBeVisible();
    await expect(detail.getByText(pos, { exact: true })).toBeVisible();
    await expect(detail.getByText(notes, { exact: true })).toBeVisible();
    await expect(detail.getByText(groupName, { exact: true })).toBeVisible();

    // 改电话：详情 view 态「编辑」按钮（文本）→ 编辑态表单 #cd-phone → 「保存」
    await detail.getByRole("button", { name: "编辑", exact: true }).click();
    await detail.locator("#cd-phone").fill(newPhone);
    await detail.getByRole("button", { name: "保存", exact: true }).click();
    await expect(detail.getByText(newPhone, { exact: true })).toBeVisible();
    await expect(detail.getByText(phone, { exact: true })).toHaveCount(0);

    // 持久化硬证据：重载后重开详情仍是新电话（列表行不自动刷新，故先 reload）
    await page.reload();
    await page.getByRole("button", { name: contactName }).click();
    await expect(
      page.getByRole("heading", { name: contactName, level: 3, exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("aside.border-l").getByText(newPhone, { exact: true })).toBeVisible();

    // 删除：详情头「删除」按钮（aria-label）→ 确认视图「确认删除此联系人？」→ danger「删除」。
    // 两步点击都收进 detail 作用域：侧栏分组删除按钮 aria-label 同名且 opacity-0 仍判 visible。
    await page.locator("aside.border-l").getByRole("button", { name: "删除", exact: true }).click();
    await expect(
      page.locator("aside.border-l").getByText("确认删除此联系人？", { exact: true }),
    ).toBeVisible();
    await page.locator("aside.border-l").getByRole("button", { name: "删除", exact: true }).click();
    // 确认视图点击后详情关闭（remove 成功才 onClose），等它卸载即等 DELETE 落库
    await expect(page.locator("aside.border-l")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("button", { name: contactName })).toHaveCount(0);
    await expect(page.getByText("暂无联系人", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("分组：建两组、组内过滤、删组回落全部联系人 + 搜索", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-contact"), "E2E联系人工作区");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const groupA = `E2E甲组-${suffix}`;
    const groupB = `E2E乙组-${suffix}`;
    const contactName = `E2E联系人-${suffix}`;

    await page.goto(`/w/${wid}/contacts`);
    // 等侧栏首拉落地再建组：挂载 GET 慢于建组响应时会覆盖乐观 append（实测 flaky 根因）
    await waitForContactGroupsLoaded(page);
    // 建两组（Enter 提交法规避「新建分组」提交按钮与页头「新建联系人」撞名）
    for (const g of [groupA, groupB]) {
      await page.getByRole("button", { name: "新建分组", exact: true }).click();
      await page.getByPlaceholder("分组名称").fill(g);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: g, exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }

    // 联系人落 A 组：仅填姓名 + 分组
    await page.getByRole("button", { name: "新建联系人", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("姓名").fill(contactName);
    await expect(dialog.locator("#cc-group")).toContainText(groupA);
    await dialog.locator("#cc-group").selectOption({ label: groupA });
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: contactName, level: 3, exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // 点 A 组行过滤（侧栏分组按钮 accessible name=组名全串）
    await page.getByRole("button", { name: groupA, exact: true }).click();
    await expect(page.getByRole("button", { name: contactName })).toHaveCount(1);
    // 侧栏计数不随建联系人自动刷新（建组时客户端拼 _count:0，与列表 stale 同性质）；
    // reload 后服务端真实计数回显，再断言组内计数为 1
    await page.reload();
    await page.getByRole("button", { name: groupA, exact: true }).click();
    await expect(
      page.locator("div.group", { hasText: groupA }).getByText("1", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: contactName })).toHaveCount(1);

    // 回落全部联系人（accessible name=「全部联系人 N」，子串匹配）
    await page.getByRole("button", { name: "全部联系人" }).click();
    await expect(page.getByRole("button", { name: contactName })).toHaveCount(1);

    // 删组：hover 显形后点组行删除按钮（title=删除，无 confirm 直接 DELETE；删选中组自动回落全部）
    const rowA = page.locator("div.group", { hasText: groupA });
    await rowA.hover();
    await rowA.locator('button[title="删除"]').click();
    // 删组不删联系人：A 组消失、B 组仍在、联系人行仍在
    await expect(page.getByRole("button", { name: groupA, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: groupB, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: contactName })).toHaveCount(1);

    // 搜索：无命中走同一空态文案；清空后行回（详情未与本流程交互，无同文案干扰）
    await page.getByPlaceholder("搜索联系人…").fill(`zzz-no-such-${suffix}`);
    await expect(page.getByText("暂无联系人", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder("搜索联系人…").fill("");
    await expect(page.getByRole("button", { name: contactName })).toHaveCount(1);
  });
});
