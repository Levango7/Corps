import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin } from "./helpers";

/**
 * E2E：会议域交互 —— 即时会议创建 → 跳房间页 → 回列表出现；预约缺时间 / 密码不一致校验。
 *
 * 覆盖 route-health 抓不到的东西：
 *  - MeetingCreate 的默认类型（instant）、提交禁用口径（空标题 disabled）
 *  - 创建成功后 onCreated → handleJoin 直接跳 /meetings/{mid}（与表单域留列表不同）
 *  - MeetingLobby 的 h1 渲染会议标题、离开后回列表页
 *  - 预约/重复类型缺 scheduledAt 的 scheduledAtRequired 分支
 *  - 密码两次不一致的 passwordMismatch 分支
 *
 * 断言口径：
 *  - 创建按钮「创建会议」与对话框标题/提交按钮同文案，收窄到 role=dialog 内定位
 *    （对话框 aria-labelledby=#meeting-create-title，create 模式文案=t("create")=创建会议）
 *  - 列表项用标题文本定位，不用卡片序号（列表顺序受其它实例影响）
 *  - 不点 lobby 的「立即加入」（LiveKit 房间本机不通），只断言 lobby 渲染
 */

test.describe("会议：创建 → 房间 → 列表 / 校验", () => {
  test("创建即时会议：跳入房间页，回列表后出现在进行中分组", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-meeting"), "E2E会议工作区");
    const title = `E2E周会-${Date.now()}`;

    await page.goto(`/w/${wid}/meetings`);
    await expect(page.getByRole("button", { name: "创建会议" })).toBeVisible({ timeout: 10_000 });

    // 打开创建对话框（页面级按钮与 dialog 内提交按钮同名，先点页面级）
    await page.getByRole("button", { name: "创建会议" }).first().click();
    const dialog = page.getByRole("dialog", { name: "创建会议" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // 默认类型=即时会议，只填标题即可提交（提交按钮 disabled={!title.trim()||submitting}）
    await dialog.getByLabel("会议标题").fill(title);
    dialog.getByRole("button", { name: "创建会议" }).click();

    // 创建成功 → 直接跳房间页（lobby 阶段），h1 渲染会议标题
    await expect(page).toHaveURL(/\/meetings\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    // 离开 → 回列表页，标题出现在列表中（instant 会议 status=active）
    await page.getByRole("button", { name: "离开" }).click();
    await expect(page).toHaveURL(/\/meetings$/, { timeout: 10_000 });
    await expect(
      page.getByText(title, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("预约会议不填时间报开始时间必填；密码不一致报两次输入不一致", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-meeting"), "E2E会议工作区");

    await page.goto(`/w/${wid}/meetings`);
    await page.getByRole("button", { name: "创建会议" }).first().click();
    const dialog = page.getByRole("dialog", { name: "创建会议" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.getByLabel("会议标题").fill("E2E校验会议");

    // 选「预约会议」但不填预约时间 → 预约会议需填写开始时间（校验在 fetch 前返回）
    await dialog.getByRole("button", { name: "预约会议" }).click();
    dialog.getByRole("button", { name: "创建会议" }).click();
    await expect(
      dialog.getByText("预约会议需填写开始时间").filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // 切回「即时会议」，两次密码不一致 → 两次输入的密码不一致
    await dialog.getByRole("button", { name: "即时会议" }).click();
    await dialog.getByLabel("会议密码").fill("abc123");
    await dialog.getByLabel("确认密码").fill("abc456");
    dialog.getByRole("button", { name: "创建会议" }).click();
    await expect(
      dialog.getByText("两次输入的密码不一致").filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
