import { expect, test } from "@playwright/test";
import { registerAndLogin } from "./helpers";

/**
 * 路由健康门禁（Route Health Gate）：
 *
 *  1. 任何工作区路由都不得整页崩到路由级错误边界（app/[locale]/error.tsx）
 *  2. 不得出现未捕获异常（pageerror）
 *  3. 不得出现 next-intl 的 MISSING_MESSAGE（它意味着界面上渲染的是原始翻译 key）
 *
 * ## 为什么需要它（三个真实缺陷的教训，均已在 main 上存在过）
 *
 *  - 提交 1e90b5e9 把 9 个组件改成 async Server Component，其中 6 个被 "use client"
 *    模块 import，getTranslations 在客户端抛错，设置页等 6 处整页崩到错误边界，
 *    而 CI 12 项必需检查一道都看不到——因为没有任何测试真的渲染过这些页面。
 *    本 spec 就是补这一层：逐路由真实渲染。
 *  - /w/[wid]/settings/permissions 把 GET 响应体直接当矩阵用（外层套了 roles、
 *    格值是动作数组），matrixEqual 读 undefined 抛 TypeError，整页崩。同样是
 *    「只有真渲染才暴露」的缺陷类。
 *  - CommandPalette 用 useTranslations("nav") 却传完整路径 key，首屏 8 个导航项
 *    全部显示 nav.nav.menu.*，且 ⌘K 搜索因此失效。MISSING_MESSAGE 是这类缺陷的
 *    确定性信号。
 *
 * ## 断言点的选择
 *
 *  - 错误边界判定用可见文案「页面出错了」（error.pageError，全仓唯一，仅
 *    app/[locale]/error.tsx 渲染）。不用 role=alert 或 aria-live——not-found.tsx、
 *    公告、看板、MeetingRoom 里都有 aria-live="assertive"，会误报。
 *  - MISSING_MESSAGE 是 next-intl 对「键解析失败」的 console.error，比扫 DOM 里的
 *    key 形状字符串精确（后者会被邮箱、ID、时间戳误伤）。
 *
 * ## 刻意不覆盖的维度
 *
 *  - 横向溢出（如 375px 顶栏 +18px）不在此门禁内：当前是已知未修项，纳入即红。
 *    归布局专项，修完后再加。
 *  - 动态路由（[aid]/[dbid]/[id]/[cid]/[mid]）需要先造实体，本 spec 只覆盖静态
 *    路由；列表页已渲染，详情页的崩溃由对应功能 E2E 覆盖。
 *
 * 路由清单由 web/app/[locale]/w/[wid]/ 下的 page.tsx 生成（剔除含 [ 的动态段）：
 *   find "web/app/[locale]/w/[wid]" -name page.tsx | grep -v "\[" | sort
 *
 * 共两轮：默认视口（1280x720，三类断言全量）+ 375px 视口（横向溢出 + 错误边界）。
 * 之所以要 375 那一轮：P1-3 顶栏溢出在 1280 下溢出 0px、375 下溢出 18px，
 * 只跑默认视口的门禁对它完全失明。详情见第二个 test 的注释。
 *
 * 挂在 e2e/ 下即自动进入 CI 的「E2E (production build)」job。
 */

test.setTimeout(480_000);

/** 静态路由清单（36 条，生成方式见文件头注释）。 */
const WORKSPACE_ROUTES: readonly string[] = [
  "/",
  "/ai-tools",
  "/ai-usage",
  "/analytics",
  "/announcement-draft",
  "/announcements",
  "/approvals",
  "/assistant",
  "/billing",
  "/board",
  "/calendar",
  "/contacts",
  "/daily-report",
  "/databases",
  "/decisions",
  "/documents",
  "/files",
  "/forms",
  "/im",
  "/insight",
  "/knowledge-qa",
  "/meeting-minutes",
  "/meetings",
  "/members",
  "/my-tasks",
  "/notifications",
  "/okr",
  "/recycle-bin",
  "/settings",
  "/settings/calendar",
  "/settings/permissions",
  "/templates",
  "/time-tracking",
  "/whiteboards",
  "/wiki",
  "/workflows",
];

/** 路由级错误边界的唯一可见文案（error.pageError）。 */
const BOUNDARY_TEXT = "页面出错了";

test.describe.serial("路由健康门禁", () => {
  /** 每个测试现取唯一邮箱（与其他 spec 的隔离口径一致）。 */
  const uniqueEmail = () =>
    "e2e-route-health-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "@e2e.local";

  test("全部工作区静态路由：无错误边界 / 无未捕获异常 / 无 MISSING_MESSAGE", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail());

    const pageErrors: string[] = [];
    const missingMessages: string[] = [];
    const routeErrorLogs: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.name + ": " + err.message));
    page.on("console", (msg) => {
      const t = msg.text();
      if (msg.type() === "error" && t.includes("MISSING_MESSAGE")) missingMessages.push(t);
      if (t.includes("[route-error]")) routeErrorLogs.push(t.slice(0, 300));
    });

    /** 崩到错误边界的路由 → 边界 console 里捕获到的原始报错摘要（便于定位）。 */
    const crashed: string[] = [];

    for (const route of WORKSPACE_ROUTES) {
      await page.goto("/w/" + wid + route, { waitUntil: "load" });
      // 等水合与（若有的话）错误边界落地。错误边界在 render 抛错时同步渲染，
      // 但 hydration 错误可能在网络静默后才浮现，给一个固定稳态窗口。
      // ⛔ 不能用 waitForLoadState("networkidle")：/im 与仪表盘挂了在线成员条
      //    （POST /presence 心跳每 2 分钟一次），网络永远静默不下来，首跑实测
      //    在这里把 5 分钟的 test timeout 整个吃光。轮询型页面必须用固定延时。
      await page.waitForTimeout(1000);

      const hit = await page
        .getByText(BOUNDARY_TEXT, { exact: true })
        .first()
        .isVisible()
        .catch(() => false);
      if (hit) {
        const log = routeErrorLogs.at(-1) ?? "(console 未捕获到 route-error 日志)";
        crashed.push(route + "  <-  " + log);
      }
    }

    const crashMsg = crashed.length
      ? "以下路由整页崩到路由级错误边界（app/[locale]/error.tsx）：" + crashed.join("\n")
      : "";
    expect(crashed, crashMsg).toEqual([]);

    const errMsg = pageErrors.length
      ? "存在未捕获异常（pageerror）：" + [...new Set(pageErrors)].slice(0, 10).join("\n")
      : "";
    expect(pageErrors, errMsg).toEqual([]);

    const missMsg = missingMessages.length
      ? "存在 MISSING_MESSAGE（界面渲染了原始翻译 key）：" +
        [...new Set(missingMessages)].slice(0, 10).join("\n")
      : "";
    expect([...new Set(missingMessages)], missMsg).toEqual([]);
  });

  /**
   * 375px 视口：无横向溢出 + 无错误边界。
   *
   * ## 为什么单独一轮（2026-10-17 P1-3 的教训）
   *
   * 上面那轮跑在 Playwright 默认视口（playwright.config.ts 用
   * `devices["Desktop Chrome"]` = 1280x720），**纯响应式缺陷在该宽度下完全不暴露**：
   * 工作区顶栏右簇在 375px 下越界 17.5px（documentElement.scrollWidth=393 vs
   * clientWidth=375，整页可被横向拖走 18px、左 hamburger 被推出屏），而 1280 下
   * 溢出 0px —— 路由健康门禁跑完整整 36 条路由都没发现它。
   *
   * 判据用 `documentElement.scrollWidth === clientWidth`：
   *   - DOM 级、无需等动画、不依赖具体元素 rect；
   *   - 溢出即红，不受「元素有没有被挤扁」影响（挤扁不溢出但同样坏，那类问题
   *     归布局专项，不在此门禁）。
   *
   * 刻意只跑静态路由（与上一轮同清单），且只断言溢出与错误边界两项 ——
   * MISSING_MESSAGE / pageerror 与视口无关，已被上一轮覆盖。
   */
  test("375px 视口：无横向溢出 / 无错误边界（36 条静态路由）", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail());

    await page.setViewportSize({ width: 375, height: 812 });

    /** 横向溢出的路由 → 溢出像素数。 */
    const overflows: { route: string; px: number }[] = [];
    const crashed: string[] = [];
    const routeErrorLogs: string[] = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("[route-error]")) routeErrorLogs.push(t.slice(0, 300));
    });

    for (const route of WORKSPACE_ROUTES) {
      await page.goto("/w/" + wid + route, { waitUntil: "load" });
      // 同上一轮：不能用 networkidle（心跳/轮询型页面永不可静默，会把 test timeout 吃光）
      await page.waitForTimeout(1000);

      const m = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      const px = m.scrollWidth - m.clientWidth;
      if (px > 0) overflows.push({ route, px });

      const hit = await page
        .getByText(BOUNDARY_TEXT, { exact: true })
        .first()
        .isVisible()
        .catch(() => false);
      if (hit) crashed.push(route + "  <-  " + (routeErrorLogs.at(-1) ?? "(无 route-error 日志)"));
    }

    const of = overflows.map((o) => `${o.route}  (溢出 ${o.px}px)`);
    expect(
      of,
      `以下路由在 375px 下横向溢出（scrollWidth > clientWidth）：` + of.join("\n"),
    ).toEqual([]);
    expect(crashed, `以下路由在 375px 下崩到错误边界：` + crashed.join("\n")).toEqual([]);
  });
});
