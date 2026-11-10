import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin } from "./helpers";

/**
 * E2E：OKR 域交互 —— 新建目标弹窗提交入列 / 必填校验与取消。
 *
 * 覆盖 route-health 抓不到的东西：
 *  - OKRList 的「新建目标」按钮打开页面内联弹窗（role="dialog"），POST /objectives 后
 *    listKey 重挂刷新列表，不跳路由（与白板的一键创建、数据库的表单跳转都不同）
 *  - 弹窗提交按钮与页面级「新建目标」按钮同名（同取 okr:create），提交必须
 *    within(dialog) 作用域；打开弹窗时页面按钮唯一可直接点
 *  - 必填校验：标题或周期任一为空时提交钮 disabled（前端守卫先于服务端 400）
 *  - 列表空态「暂无目标」与创建后卡片标题、「关键结果 · 0」计数行
 */

test.describe("OKR：新建目标弹窗 / 必填校验与取消", () => {
  test("新建目标：弹窗提交后列表出现新目标", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-okr"), "E2EOKR工作区");
    const title = `E2E增长目标-${Date.now()}`;

    await page.goto(`/w/${wid}/okr`);
    // 新工作区无目标：空态文案可见
    await expect(page.getByText("暂无目标", { exact: true })).toBeVisible({ timeout: 15_000 });

    // 打开新建弹窗（此时页面按钮唯一，可直接点）
    await page.getByRole("button", { name: "新建目标" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // 弹窗内填写（label 显式 htmlFor 关联）；提交按钮与页面按钮同名，须弹窗内取
    await dialog.getByLabel("标题").fill(title);
    await dialog.getByLabel("描述").fill("全年新增注册用户翻倍");
    await dialog.getByLabel("周期").fill("2026-Q1");
    await dialog.getByRole("button", { name: "新建目标" }).click();

    // 提交成功：弹窗关闭，列表重挂后新目标卡片与计数行出现
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/关键结果 · /).first()).toBeVisible({ timeout: 10_000 });
  });

  test("弹窗必填校验：标题或周期为空时提交禁用，取消可关闭", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail("e2e-okr"), "E2EOKR工作区");

    await page.goto(`/w/${wid}/okr`);
    await expect(page.getByText("暂无目标", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "新建目标" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const submitBtn = dialog.getByRole("button", { name: "新建目标" });

    // 标题与周期全空 → disabled
    await expect(submitBtn).toBeDisabled();
    // 只填标题、周期仍空 → disabled（周期必填）
    await dialog.getByLabel("标题").fill("E2E校验目标");
    await expect(submitBtn).toBeDisabled();
    // 周期补齐 → enabled
    await dialog.getByLabel("周期").fill("2026-Q2");
    await expect(submitBtn).toBeEnabled();

    // 取消关闭：弹窗消失且列表保持空态（未提交不产生数据）
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText("暂无目标", { exact: true })).toBeVisible();
  });
});
