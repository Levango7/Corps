import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

/**
 * fixed 定位劫持回归门禁。
 *
 * 背景：`position: fixed` 的包含块并不永远等于视口——只要祖先上存在
 * `transform` / `perspective` / `filter` / `backdrop-filter` / `will-change: transform` /
 * `contain` / `transform-style: preserve-3d`，包含块就被那个祖先劫持，元素改为相对
 * 该祖先的 padding box 定位，并会被祖先的 `overflow: hidden` 一起裁切。
 *
 * 本仓库的两处受害者（证据见 PR 描述）：
 *  1. WidgetConfigPanel 的 `fixed inset-0` 全屏遮罩
 *     祖先链：RGL `.react-grid-item`（DashboardGrid.tsx:469 `useCSSTransforms` 令其带
 *     `transform: translate(...)`）→ WidgetCard.tsx:149 内联
 *     `perspective: var(--perspective-card)` → WidgetCard.tsx:240
 *     `transform-style: preserve-3d` 的 motion.div 包裹层。
 *     劫持后遮罩只覆盖 Widget 卡片那一小块，并被 WidgetCard.tsx:151 的
 *     `overflow-hidden` 裁掉。
 *  2. QuickActionMenu 的 `fixed left/top` 浮窗
 *     同一条祖先链。长按传入的是视口坐标 clientX/clientY，却按卡片盒子解析，整体偏移。
 *
 * 唯一正解：`createPortal(node, document.body)`。本文件即它的防复发门禁——不靠肉眼，
 * 靠 getBoundingClientRect() 与视口的数值关系判定。
 */

/** 劫持 fixed 包含块的祖先描述 */
interface Hijacker {
  tag: string;
  cls: string;
  prop: string;
  value: string;
}

declare global {
  interface Window {
    __findHijacker?: (el: Element | null) => Hijacker | null;
  }
}

/** 注入到页面：向上找第一个劫持 fixed 包含块的祖先（失败时作为诊断证据输出）。 */
const HIJACK_PROBE = `
window.__findHijacker = (el) => {
  const PROPS = ["transform","perspective","filter","backdropFilter","willChange","contain","transformStyle"];
  let node = el ? el.parentElement : null;
  while (node) {
    const cs = getComputedStyle(node);
    for (const p of PROPS) {
      const v = cs[p];
      if (!v) continue;
      const idle = v === "none" || v === "auto" || v === "normal" || v === "flat";
      if (!idle) {
        return { tag: node.tagName.toLowerCase(), cls: String(node.className || "").slice(0, 140), prop: p, value: v };
      }
    }
    node = node.parentElement;
  }
  return null;
};
`;

/** 遮罩（role=dialog 的父节点）几何 + 挂载点 + 劫持者诊断 */
async function probeOverlay(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!dialog) return null;
    const overlay = dialog.parentElement;
    if (!overlay) return null;
    const r = overlay.getBoundingClientRect();
    const de = document.documentElement;
    return {
      position: getComputedStyle(overlay).position,
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
      /** 布局视口（不含滚动条），fixed 包含块未劫持时的基准 */
      vw: de.clientWidth,
      vh: de.clientHeight,
      parentIsBody: overlay.parentElement === document.body,
      hijacker: window.__findHijacker ? window.__findHijacker(overlay) : null,
    };
  });
}

/** 浮窗菜单几何 + 挂载点 + 劫持者诊断（按菜单项文案反查 fixed 容器） */
async function probeMenu(page: import("@playwright/test").Page, label: string) {
  return page.evaluate((menuLabel) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === menuLabel,
    );
    if (!btn) return null;
    let menu: HTMLElement | null = btn;
    while (menu && getComputedStyle(menu).position !== "fixed") menu = menu.parentElement;
    if (!menu) return null;
    const r = menu.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
      parentIsBody: menu.parentElement === document.body,
      hijacker: window.__findHijacker ? window.__findHijacker(menu) : null,
    };
  }, label);
}

/**
 * 等工作区壳水合完成。
 *
 * web/e2e/README.md「新用例约定」：waitForURL(/\/w\//) 之后不代表 UI 可用，
 * 要等一个稳定元素。这里与 ui-style.spec.ts「工作区首页」用例用同一个信号
 * （顶栏搜索按钮）——SSR 首屏不含客户端交互态，它出现即说明 React 事件委托
 * 已绑定。少了这步，齿轮按钮虽 SSR 直出、toBeVisible 已通过，点击仍可能落进
 * 水合前的静默窗口被吞掉（2026-10-29 #208 实证：同一 tree PR 绿、main 连红两轮）。
 */
async function waitForWorkspaceHydration(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: /搜索/ }).first()).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("fixed 浮层不被祖先 transform/perspective 劫持", () => {
  test("WidgetConfigPanel 遮罩：铺满整个视口且挂在 body 下", async ({ page }) => {
    await registerAndLogin(page, uniqueEmail("e2e-fixed"));
    await waitForWorkspaceHydration(page);
    await page.evaluate(HIJACK_PROBE);

    // 进入编辑模式，齿轮按钮才出现
    await page.getByRole("button", { name: "编辑布局" }).click();
    const gear = page.locator('[aria-label="configure widget"]').first();
    await expect(gear).toBeVisible({ timeout: 20_000 });

    const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
    // 主修是上面的 waitForWorkspaceHydration：补上 README 要求的确定性水合等待后，
    // 点击落进静默窗口的根因已被消除。下面这层重试只作防御深度，挡的是
    // 「工作区壳水合完成」与「DashboardGrid dynamic import(ssr:false) 挂载完成」
    // 之间仍可能存在的小窗口，不是拿来碰运气。本用例测的是弹层的几何与挂载点，
    // 重试不掩盖任何被测行为；打开链路真坏了时 3 次全失败，最终断言照样红。
    //
    // 退役条件：连续两周 CI 的 E2E 日志里没有 [hydration-retry] 警告，
    // 即可把整个循环删成单次 click + expect(dialog).toBeVisible()。
    // 别写成「看 E2E 报告」：ci.yml 的 Upload Playwright artifacts 挂在
    // if: failure()，绿的 run 根本不上传 pw-report.json；绿时只有日志可见。
    // 现在不删的理由：本机无 chromium 跑不了 Playwright，且历史上正是「PR 事件绿、
    // main 连红两轮」，一次 CI 绿不足以证明 flaky 已根治；E2E 是必需检查，
    // 红了会冻结全仓合并（见 README「门禁先红后修的落地方式」）。
    // 进展：#282 合并点 29e7dfe 的 main 事件 15 项检查全 success（含 E2E），
    // 但仍是单次样本，按上面的日志判据再观察两周。
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
      await gear.click();
      try {
        await expect(dialog).toBeVisible({ timeout: 4_000 });
        opened = true;
      } catch {
        if (attempt === 0) {
          // 双通道可观测：warn 进 CI 的 list reporter 日志（成功时也在，供退役判据用）；
          // annotation 进 pw-report.json（CI 仅 failure() 时上传，供失败诊断用）。
          console.warn(
            "[hydration-retry] 首次点击未打开弹层：水合等待之后仍出现残余时序窗口",
          );
          test.info().annotations.push({
            type: "hydration-retry",
            description: "首次点击未打开弹层：水合等待之后仍出现残余时序窗口",
          });
        }
      }
    }
    expect(opened, "点齿轮 3 次后弹层仍未出现——打开链路真坏了，不是时序抖动").toBe(true);
    // 等 3D 翻转入场（rotateX -90 → 0）结束，几何才稳定
    await page.waitForTimeout(700);

    const p = await probeOverlay(page);
    if (!p) throw new Error("未取到遮罩几何：[role=dialog] 或其父节点缺失");

    expect(p.position, "遮罩必须是 position:fixed").toBe("fixed");
    expect(
      p.parentIsBody,
      `遮罩未 portal 到 document.body（被祖先劫持）：${JSON.stringify(p.hijacker)}`,
    ).toBe(true);
    expect(p.x, `遮罩左上角 x 应为 0，实际 ${p.x}；劫持者 ${JSON.stringify(p.hijacker)}`).toBe(0);
    expect(p.y, `遮罩左上角 y 应为 0，实际 ${p.y}；劫持者 ${JSON.stringify(p.hijacker)}`).toBe(0);
    expect(
      p.width,
      `遮罩宽度应等于视口宽 ${p.vw}，实际 ${p.width}；劫持者 ${JSON.stringify(p.hijacker)}`,
    ).toBe(p.vw);
    expect(
      p.height,
      `遮罩高度应等于视口高 ${p.vh}，实际 ${p.height}；劫持者 ${JSON.stringify(p.hijacker)}`,
    ).toBe(p.vh);
  });

  test("QuickActionMenu 浮窗：落在触发坐标上且挂在 body 下", async ({ page }) => {
    await registerAndLogin(page, uniqueEmail("e2e-fixed"));
    await waitForWorkspaceHydration(page);
    await page.evaluate(HIJACK_PROBE);

    const cardBody = page.locator(".react-grid-item").first();
    await expect(cardBody).toBeVisible({ timeout: 20_000 });

    // 右键 = useLongPress 的 onContextMenu 分支（等价移动端长按，且不必等 500ms 计时器）。
    // 取卡片纵向 80px 处，避开约 41px 高的标题栏，确保落在长按手势挂载的内容区。
    const box = await cardBody.boundingBox();
    if (!box) throw new Error("首个 .react-grid-item 没有 boundingBox");
    const targetX = Math.round(box.x + box.width / 2);
    const targetY = Math.round(box.y + Math.min(80, box.height / 2));

    await page.mouse.click(targetX, targetY, { button: "right" });
    await expect(page.getByRole("button", { name: "删除" }).first()).toBeVisible({
      timeout: 10_000,
    });
    // 等弹簧入场（stiffness 400 / damping 28）收敛，y 偏移归零
    await page.waitForTimeout(600);

    const m = await probeMenu(page, "删除");
    if (!m) throw new Error("未取到浮窗几何：菜单项「删除」或 fixed 容器缺失");

    expect(
      m.parentIsBody,
      `浮窗未 portal 到 document.body（被祖先劫持）：${JSON.stringify(m.hijacker)}`,
    ).toBe(true);
    expect(
      Math.abs(m.x - targetX),
      `浮窗 x 应贴合触发点 ${targetX}，实际 ${m.x}；劫持者 ${JSON.stringify(m.hijacker)}`,
    ).toBeLessThanOrEqual(4);
    expect(
      Math.abs(m.y - targetY),
      `浮窗 y 应贴合触发点 ${targetY}，实际 ${m.y}；劫持者 ${JSON.stringify(m.hijacker)}`,
    ).toBeLessThanOrEqual(4);
  });
});
