import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin, login } from "./helpers";

/**
 * E2E：计费流程 —— 查看计费页 → 套餐展示 → 支付方式选择 → 定价页。
 *
 * 覆盖：
 *  - 计费页渲染（当前套餐 / 席位 / 套餐卡片）
 *  - 免费与专业套餐展示
 *  - 互链到 /pricing 定价页
 *  - 支付方式选择（信用卡 / 微信支付 / 支付宝）—— 仅 Stripe 配置可用时
 *  - /pricing 定价页 SSR 渲染
 *
 * 约束：
 *  - 不实际发起支付（会跳转外部通道，E2E 环境无 Stripe）
 *  - 支付方式按钮仅在 stripeReady && isOwner 时渲染，用条件断言兼容未配置环境
 */

const email = uniqueEmail("e2e-billing");
let workspaceId: string;

test.describe.serial("计费流程：计费页 → 套餐 → 支付方式 → 定价页", () => {
  test("注册并进入工作区", async ({ page }) => {
    workspaceId = await registerAndLogin(page, email, "E2E计费工作区");
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible({ timeout: 10_000 });
  });

  test("计费页渲染：标题/当前套餐/席位/套餐卡片", async ({ page }) => {
    await login(page, email);
    await page.goto(`/w/${workspaceId}/billing`);

    // 标题
    await expect(page.getByRole("heading", { name: "计费" })).toBeVisible({ timeout: 10_000 });

    // 当前套餐 + 席位（exact 匹配席位徽章——正文/卡片文案多处含"席位"）
    await expect(page.getByText("当前套餐")).toBeVisible();
    await expect(page.getByText("席位", { exact: true })).toBeVisible();

    // 免费套餐（新注册用户默认 free；.first()：套餐名出现两处不同字号实例）
    await expect(page.getByText("免费", { exact: true }).first()).toBeVisible();
    // 专业套餐
    await expect(page.getByText("专业", { exact: true }).first()).toBeVisible();

    // 「使用中」标记（当前套餐为 free）
    await expect(page.getByText("使用中", { exact: true })).toBeVisible();
  });

  test("计费页互链到 /pricing 定价页", async ({ page }) => {
    await login(page, email);
    await page.goto(`/w/${workspaceId}/billing`);

    // 点击「查看完整功能对比」链接
    await page.getByRole("link", { name: "查看完整功能对比" }).click();
    await page.waitForURL(/\/pricing/, { timeout: 10_000 });

    // pricing 页 SSR 渲染：应显示 hero 标题（i18n）
    // zh locale 下 pricing 页有功能对比表
    await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });
  });

  test("支付方式选择（条件性：仅 Stripe 配置可用时）", async ({ page }) => {
    await login(page, email);
    await page.goto(`/w/${workspaceId}/billing`);

    // 等待计费状态加载
    await expect(page.getByText("当前套餐")).toBeVisible({ timeout: 10_000 });

    // 支付方式按钮仅在 stripeReady && isOwner 时渲染
    const cardBtn = page.getByRole("button", { name: "信用卡", exact: true });
    const isPaymentVisible = await cardBtn.isVisible().catch(() => false);

    if (isPaymentVisible) {
      // 验证三种支付方式按钮都在
      await expect(cardBtn).toBeVisible();
      await expect(page.getByRole("button", { name: "微信支付", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "支付宝", exact: true })).toBeVisible();

      // 切换到微信支付
      await page.getByRole("button", { name: "微信支付", exact: true }).click();
      // 切换后应显示微信支付说明文案
      await expect(page.getByText(/扫码支付/)).toBeVisible();

      // 切换到支付宝
      await page.getByRole("button", { name: "支付宝", exact: true }).click();
      await expect(page.getByText(/跳转到支付宝/)).toBeVisible();

      // 切回信用卡
      await page.getByRole("button", { name: "信用卡", exact: true }).click();
      await expect(page.getByText(/Stripe 完成信用卡支付/)).toBeVisible();
    } else {
      // Stripe 未配置：应显示未配置提示
      await expect(page.getByText(/未配置 Stripe/)).toBeVisible();
    }
  });

  test("/pricing 定价页直接访问渲染正常", async ({ page }) => {
    await page.goto("/pricing");

    // pricing 页有导航栏（corps logo）
    await expect(page.getByRole("link", { name: "corps", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // 功能对比表
    await expect(page.getByRole("table")).toBeVisible();

    // FAQ 区（details 元素）
    await expect(page.locator("details").first()).toBeVisible();
  });
});
