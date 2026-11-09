import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin } from "./helpers";

/**
 * E2E：审批域交互 —— 发起审批（指定审批人）→ 列表出现 → 详情待审批 → 同意。
 *
 * 覆盖 route-health 抓不到的东西：
 *  - ApprovalSubmit 的「不选模板时必须指定审批人」分支与提交链路
 *  - 提交后 ApprovalList 经 refreshKey 重建、新实例真出现在列表
 *  - 详情页状态徽标与「同意」动作真实可点
 *
 * 断言口径：
 *  - 按钮/输入文案走 zh 词条（approval.*），不用 role=dialog 定位弹窗
 *    （dev 模式下 Next 错误浮层也是 role=dialog，见 ui-layout.spec 的注释）
 *  - 列表项用标题文本定位，不用卡片序号（列表顺序受其它实例影响）
 *  - 审批人下拉是动态的（成员名），取第一个非占位 option，不写死名字
 */

/**
 * 弹窗里的「提交」按钮。
 *
 * 注意：审批弹窗的确认按钮文案也是「发起审批」（approval.submit 词条），
 * 与打开弹窗的工具栏按钮同名 —— 这是产品侧的一个小缺陷（见本轮 finding），
 * 所以这里必须把定位收窄到弹窗内：页面还有一个常驻 DOM 的移动端抽屉
 * 也是 role=dialog（见 ui-layout.spec 的注释），不能直接用 role=dialog。
 */
function submitDialog(page: import("@playwright/test").Page) {
  return page.getByRole("dialog", { name: "发起审批" }).getByRole("button", { name: "发起审批" });
}

test.describe("审批：发起 → 列表 → 详情 → 同意", () => {
  test("发起审批：不选模板时选审批人 + 填标题，提交后列表出现该实例", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-approval"), "E2E审批工作区");
    const title = `E2E请假-${Date.now()}`;

    await page.goto(`/w/${wid}/approvals`);
    await expect(page.getByRole("button", { name: "发起审批" })).toBeVisible({ timeout: 10_000 });

    // 打开发起弹窗（标题输入框：role=textbox name=审批 —— 页面还有个
    // aria-label="审批" 的 tablist 与同名 dialog，用 getByLabel 会 strict 冲突）
    await page.getByRole("button", { name: "发起审批" }).first().click();
    const titleBox = page.getByRole("textbox", { name: "审批" });
    await expect(titleBox).toBeVisible({ timeout: 10_000 });

    // 不选模板 → 必须指定审批人（占位项 value 为空，取第一个真实成员）
    await page.getByLabel("选择模板").selectOption("");
    const approverSelect = page.getByLabel("选择审批人");
    await expect(approverSelect).toBeVisible();
    const approverValue = await approverSelect
      .locator("option")
      .evaluateAll(
        (opts) =>
          (opts as unknown as HTMLOptionElement[]).map((o) => o.value).find((v) => v !== "") ?? "",
      );
    expect(approverValue, "工作区里应有可选审批人").not.toBe("");
    await approverSelect.selectOption(approverValue);

    await titleBox.fill(title);
    await submitDialog(page).click();

    // 弹窗关闭 + 列表出现该实例（refreshKey 重建 ApprovalList）
    await expect(titleBox).toHaveCount(0, { timeout: 15_000 });
    await expect(
      page.getByText(title, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("详情页：状态徽标为待审批，同意后变为已通过", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-approval"), "E2E审批工作区");
    const title = `E2E报销-${Date.now()}`;

    await page.goto(`/w/${wid}/approvals`);
    await page.getByRole("button", { name: "发起审批" }).first().click();
    await page.getByLabel("选择模板").selectOption("");
    const approverSelect = page.getByLabel("选择审批人");
    const approverValue = await approverSelect
      .locator("option")
      .evaluateAll(
        (opts) =>
          (opts as unknown as HTMLOptionElement[]).map((o) => o.value).find((v) => v !== "") ?? "",
      );
    await approverSelect.selectOption(approverValue);
    await page.getByRole("textbox", { name: "审批" }).fill(title);
    await submitDialog(page).click();
    await expect(
      page.getByText(title, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // 打开详情
    await page.getByText(title, { exact: true }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/approvals\/[0-9a-f-]{36}/i, { timeout: 10_000 });

    // 待审批徽标
    await expect(page.getByText("待审批").filter({ visible: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // 同意（详情页动作）
    await page.getByRole("button", { name: "同意" }).click();
    await expect(page.getByText("已通过").filter({ visible: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
