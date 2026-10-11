import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./helpers";

/**
 * 视觉回归（CI-only）：
 *
 *  1. 基线只在 CI 环境生成与比对（--update-snapshots=missing 首跑记录）——
 *     本仓字体是系统字体栈（Inter→Noto Sans SC→系统回退，未自托管），
 *     Windows 本地与 Ubuntu CI 字形宽度不同，跨平台像素比对必然假红。
 *     故本 spec 在本地跳过（test.skip(!CI)），只在 CI 生产构建上跑。
 *  2. 确定性前提（破坏任意一条基线即失效）：
 *     - 动画全冻结（page-enter / modal-enter 等 CSS 动画 0s 直落终态）
 *     - 明色主题强制（Playwright 默认 colorScheme=light，theme-init 同步后仍 light）
 *     - 截图视图不含时间/用户相关内容（仪表盘无问候语与日期渲染、
 *       palette 不显示用户身份；每视图均为空状态或静态内容）
 *  3. 新增视图时：CI 首跑自动记录（missing 模式），从 E2E job 的
 *     visual-snapshots 产物下载提交入库后即纳入比对。
 *
 * 挂在 e2e/ 下自动进入 CI「E2E (production build)」job。
 */

// bypassCSP：动画冻结依赖内联 <style> 注入，本仓 CSP style-src 只放行 'self'+nonce，
// 不放行 inline——无此开关 addStyleTag 必被拦（CI 生产构建下实测）。
test.use({ bypassCSP: true });

test.skip(!process.env.CI, "视觉回归基线只在 CI 环境生成与比对（跨平台字体渲染不可比），本地跳过");

/** 冻结全部 CSS 动画/过渡——screenshot 前注入，消除 page-enter/modal-enter 时序。 */
const FREEZE_ANIMATIONS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

/** 视口截图：明色主题 + 动画冻结 + 水合等待 + 绘制稳定短延时。 */
async function snapshotView(page: import("@playwright/test").Page, name: string) {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addStyleTag({ content: FREEZE_ANIMATIONS });
  await page.waitForTimeout(400); // 字体与布局绘制稳定
  // toHaveScreenshot 是 page 级截图断言（toMatchSnapshot 只对 locator/Buffer 等泛型目标可用）
  await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.0001 });
}

// 固定工作区名：registerAndLogin 默认名带时间戳，会渲染进工作区头部
// （"corps / <名字>"），每轮截图必 diff。邮箱仍保持唯一。
const FIXED_WS_NAME = "视觉基线工作区";

test.describe.serial("视觉回归（CI-only）", () => {
  test("注册页", async ({ page }) => {
    await page.goto("/auth/signup");
    await expect(page.getByLabel("邮箱")).toBeVisible();
    await snapshotView(page, "signup");
  });

  test("登录页", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.getByLabel("邮箱")).toBeVisible();
    await snapshotView(page, "login");
  });

  test("工作区仪表盘（空状态）", async ({ page }) => {
    const uniqueEmail = () =>
      `e2e-visual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;
    await registerAndLogin(page, uniqueEmail(), FIXED_WS_NAME);
    await expect(page.getByRole("button", { name: /搜索/ }).first()).toBeVisible({
      timeout: 15_000,
    });
    await snapshotView(page, "dashboard");
  });

  test("Cmd+K 命令面板", async ({ page }) => {
    const uniqueEmail = () =>
      `e2e-visual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;
    await registerAndLogin(page, uniqueEmail(), FIXED_WS_NAME);
    await page.getByRole("button", { name: /搜索/ }).first().click();
    const dialog = page.locator('[role="dialog"][aria-label="命令面板"]');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await snapshotView(page, "cmd-palette");
  });
});
