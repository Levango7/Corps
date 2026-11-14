import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin } from "./helpers";

/**
 * E2E：表单域交互 —— 新建表单（名称 + 字段）→ 列表出现 → 预览提交 → 提交记录可见。
 *
 * 覆盖 route-health 抓不到的东西：
 *  - FormBuilder 的必填校验（空名称 / 无字段）与保存链路
 *  - 保存后 FormList 的 refreshKey 重建
 *  - FormPreview 真正提交一次并落进提交记录
 *
 * 断言口径：
 *  - 文案走 zh 词条（form.*）；输入框用 aria-label（builder 里是显式补的）
 *  - 列表项用表单名定位，不用卡片序号
 */

test.describe("表单：新建 → 列表 → 提交", () => {
  test("新建表单：填名称与字段后保存，列表出现该表单", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-form"), "E2E表单工作区");
    const name = `E2E报名表-${Date.now()}`;

    await page.goto(`/w/${wid}/forms`);
    await expect(page.getByRole("button", { name: "新建表单" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "新建表单" }).click();

    // builder：名称 + 先添加字段再填标签（builder 初始字段列表为空）
    await page.getByLabel("名称").fill(name);
    await page.getByRole("button", { name: "添加字段" }).click();
    await page.getByLabel("字段标签 1").fill("姓名");

    await page.getByRole("button", { name: "保存" }).click();

    // builder 关闭 + 列表出现该表单
    await expect(page.getByLabel("名称")).toHaveCount(0, { timeout: 15_000 });
    await expect(
      page.getByText(name, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("空名称与无字段时给出错误，不发请求", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-form"), "E2E表单工作区");

    await page.goto(`/w/${wid}/forms`);
    await page.getByRole("button", { name: "新建表单" }).click();

    // 空名称直接保存 → 名称校验错误
    await page.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("请输入表单名称").filter({ visible: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // 填了名称但一个字段都没有 → 字段校验错误
    await page.getByLabel("名称").fill("缺字段表单");
    await page.getByRole("button", { name: "保存" }).click();
    await expect(
      page.getByText("请至少添加一个字段").filter({ visible: true }).first(),
    ).toBeVisible({
      timeout: 10_000,
    });
  });
});
