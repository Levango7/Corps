import { expect, test, type Page } from "@playwright/test";
import { uniqueEmail, registerAndLogin, login } from "./helpers";

/** 点击 UserMenu 头像按钮展开下拉菜单 */
async function openUserMenu(page: Page) {
  const btn = page.locator('button[aria-haspopup="menu"]');
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click({ timeout: 30_000 });
  await page.waitForSelector('[role="menu"]', { state: "visible", timeout: 10_000 });
}

/** 在已打开的 UserMenu 中点击指定语言选项 */
async function clickLanguageOption(page: Page, langName: string) {
  await page.locator('[role="menu"] button', { hasText: langName }).click();
}

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

test.describe.serial("i18n：工作区内 UserMenu 切换语言", () => {
  test("注册并进入工作区（zh）", async ({ page }) => {
    await registerAndLogin(page, email, "E2E语言工作区");
    await expect(page.getByRole("heading", { name: "概览" })).toBeVisible({ timeout: 10_000 });
  });

  test("切换 zh → en：导航文案变英文，URL 带 /en 前缀", async ({ page }) => {
    await login(page, email);

    // zh 下导航菜单应有中文项（桌面侧栏——移动抽屉同样渲染一份，限定桌面 aside 内）
    await expect(page.getByRole("link", { name: "看板", exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // 点 UserMenu 头像按钮展开下拉，再点 English 选项
    await openUserMenu(page);
    await clickLanguageOption(page, "English");

    // URL 应带 /en 前缀
    await page.waitForURL(/\/en\/w\//, { timeout: 10_000 });

    // 导航菜单文案应变为英文（同上：桌面侧栏实例）
    await expect(page.getByRole("link", { name: "Board", exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("link", { name: "Members", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Billing", exact: true }).first()).toBeVisible();
  });

  test("切换 en → zh：导航文案恢复中文，URL 去除 /en 前缀", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await login(page, email);

    // 直接导航到英文版工作区（避免第一次 UserMenu 切换的 click 超时风险）
    await page.goto(`/en/w/${wid}`);
    await expect(page.getByRole("link", { name: "Board", exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // 通过 UserMenu 切换回中文（只一次 UserMenu 交互，降低超时风险）
    await openUserMenu(page);
    await clickLanguageOption(page, "中文");

    // URL 应去除 /en 前缀（as-needed 模式下 zh 不带前缀）
    await page.waitForURL((url) => url.pathname.startsWith("/w/"), { timeout: 15_000 });

    // 导航菜单恢复中文（限定桌面侧栏实例，同上）
    await expect(page.getByRole("link", { name: "看板", exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("link", { name: "成员", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "计费", exact: true }).first()).toBeVisible();
  });
});
