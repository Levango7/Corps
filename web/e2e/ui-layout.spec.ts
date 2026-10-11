import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./helpers";

/**
 * UI 布局硬断言（PR #50 全屏弹窗定位劫持根因修复的固化判据）：
 *
 *  1. position:fixed 的 aria-modal 弹窗遮罩矩形 == 视口（未被裁剪/偏移）
 *  2. 弹窗祖先链上无 transform / will-change:transform（fixed 包含块劫持，
 *     单位矩阵也算——Chromium 对终帧 transform:none 仍产出单位矩阵的坑即由此抓）
 *
 * 挂在 e2e/ 下即自动进入 CI 的「E2E (production build)」job。
 */

/** 祖先链扫描：返回所有建立 fixed 包含块的祖先描述（空 = 安全）。 */
async function scanContainingBlockTraps(dialog: import("@playwright/test").Locator) {
  return dialog.evaluate((el) => {
    const traps: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      const transform = cs.transform;
      // "none" 或空 = 未建立包含块；其余（含 matrix(1,0,0,1,0,0) 单位矩阵）都算
      if (transform && transform !== "none") {
        traps.push(`${cur.tagName.toLowerCase()}.${cur.className.toString().slice(0, 60)} transform=${transform}`);
      }
      if (cs.willChange.includes("transform")) {
        traps.push(`${cur.tagName.toLowerCase()}.${cur.className.toString().slice(0, 60)} will-change=transform`);
      }
      cur = cur.parentElement;
    }
    return traps;
  });
}

test.describe.serial("UI 布局硬断言", () => {
  /** 每个测试现取唯一邮箱。 */
  const uniqueEmail = () =>
    `e2e-layout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;

  test("Cmd+K 面板：遮罩满视口 + 祖先链无包含块劫持", async ({ page }) => {
    await registerAndLogin(page, uniqueEmail());

    // 搜索按钮（桌面端 hidden md:flex，Desktop Chrome 视口下可见）。
    // CommandPalette 是 dynamic import 懒加载，首开需等 chunk 就绪（dev 模式可达十几秒）。
    await page.getByRole("button", { name: /搜索/ }).first().click();
    // 按 aria-label 收窄：dev 模式下 Next.js 错误浮层也是 role=dialog，宽松选择器会 strict 违规
    const dialog = page.locator('[role="dialog"][aria-label="命令面板"]');
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // 1) 遮罩矩形 == 视口（1px 容差）
    const box = await dialog.boundingBox();
    const vp = page.viewportSize();
    expect(box, "弹窗无 boundingBox").not.toBeNull();
    expect(Math.abs(box!.width - vp!.width), `遮罩宽 ${box!.width} ≠ 视口 ${vp!.width}`).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - vp!.height), `遮罩高 ${box!.height} ≠ 视口 ${vp!.height}`).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.x), `遮罩 x 偏移 ${box!.x}`).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y), `遮罩 y 偏移 ${box!.y}`).toBeLessThanOrEqual(1);

    // 2) 祖先链无 transform / will-change
    const traps = await scanContainingBlockTraps(dialog);
    expect(traps, `fixed 包含块劫持：\n${traps.join("\n")}`).toEqual([]);

    // 3) 遮罩背景色非透明（overlay 生效，肉眼可见的遮罩层存在）
    const bg = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, `遮罩背景色 ${bg} 为透明`).not.toBe("rgba(0, 0, 0, 0)");
  });
});
