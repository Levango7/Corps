import { expect, test } from "@playwright/test";
import { uniqueEmail, registerAndLogin, login } from "./helpers";

/**
 * E2E：i18n 切换 —— zh/en 语言切换 + 文案验证。
 *
 * 覆盖：
 *  - 默认 locale（zh）登录页中文文案
 *  - 显式 /en 前缀英文文案
 *  - 工作区内 LanguageSwitcher 切换 zh → en → zh
 *  - 切换后导航菜单文案随 locale 变化
 *
 * 依据：ADR-008 next-intl 方案 A，locales = ["zh", "en"]，默认 zh。
 * as-needed 前缀模式：zh 不带前缀，en 带 /en 前缀。
 */

const email = uniqueEmail("e2e-i18n");


test.describe("i18n：登录页文案对比（zh vs en）", () => {
  test("默认 locale（zh）登录页显示中文", async ({ page }) => {
    await page.goto("/auth/login");

    // 中文标题与按钮
    await expect(page.getByRole("heading", { name: "登录 corps" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
    await expect(page.getByLabel("邮箱")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
  });

  test("显式 /en 前缀登录页显示英文", async ({ page }) => {
    await page.goto("/en/auth/login");

    // 英文标题与按钮
    await expect(page.getByRole("heading", { name: "Sign in to corps" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });
});

test.describe.serial("i18n：工作区内 LanguageSwitcher 切换", () => {
  test("注册并进入工作区（zh）", async ({ page }) => {
    await registerAndLogin(page, email, "E2E语言工作区");
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible({ timeout: 10_000 });
  });

  test("切换 zh → en：导航文案变英文，URL 带 /en 前缀", async ({ page }) => {
    await login(page, email);

    // zh 下导航菜单应有中文项
    await expect(page.getByText("看板", { exact: true })).toBeVisible({ timeout: 10_000 });

    // 点击 LanguageSwitcher 的 English 按钮
    await page.getByRole("button", { name: "English", exact: true }).click();

    // URL 应带 /en 前缀
    await page.waitForURL(/\/en\/w\//, { timeout: 10_000 });

    // 导航菜单文案应变为英文
    await expect(page.getByText("Board", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Members", { exact: true })).toBeVisible();
    await expect(page.getByText("Billing", { exact: true })).toBeVisible();
  });

  test("切换 en → zh：导航文案恢复中文，URL 去除 /en 前缀", async ({ page }) => {
    await login(page, email);

    // 先切到 en
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.waitForURL(/\/en\/w\//, { timeout: 10_000 });
    await expect(page.getByText("Board", { exact: true })).toBeVisible({ timeout: 10_000 });

    // 切回中文
    await page.getByRole("button", { name: "中文", exact: true }).click();

    // URL 应去除 /en 前缀（as-needed 模式下 zh 不带前缀）
    await page.waitForURL(/\/w\/[0-9a-f-]{36}/, { timeout: 10_000 });

    // 导航菜单恢复中文
    await expect(page.getByText("看板", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("成员", { exact: true })).toBeVisible();
    await expect(page.getByText("计费", { exact: true })).toBeVisible();
  });
});