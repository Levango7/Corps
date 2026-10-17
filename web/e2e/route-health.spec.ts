import { expect, test } from "@playwright/test";
import { registerAndLogin, createTask } from "./helpers";

/**
 * 路由健康门禁（Route Health Gate）：
 *
 *  1. 任何工作区静态路由都不得整页崩到路由级错误边界（app/[locale]/error.tsx）
 *  2. 不得出现未捕获异常（pageerror）
 *  3. 不得出现 next-intl 的 MISSING_MESSAGE（它意味着界面上渲染的是原始翻译 key）
 *  4. 四个视口（375 / 768 / 1280 / 1920）下都不得横向溢出
 *  5. 动态详情路由（示例：/task/[id]）同样不得崩
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
 *  - 375px 顶栏右簇越界 17.5px（P1-3）：纯响应式缺陷，在 1280 下溢出 0px，
 *    1280 那一轮整跑一遍都看不见它。故有第 4 项视口矩阵。
 *
 * ## 断言点的选择
 *
 *  - 错误边界判定用可见文案「页面出错了」（error.pageError，全仓唯一，仅
 *    app/[locale]/error.tsx 渲染）。不用 role=alert 或 aria-live——not-found.tsx、
 *    公告、看板、MeetingRoom 里都有 aria-live=assertive，会误报。
 *  - MISSING_MESSAGE 是 next-intl 对「键解析失败」的 console.error，比扫 DOM 里的
 *    key 形状字符串精确（后者会被邮箱、ID、时间戳误伤）。
 *  - 溢出判定用 documentElement.scrollWidth === clientWidth：DOM 级、不依赖具体
 *    元素 rect。溢出即红；「挤扁但不溢出」同样坏，那类问题归布局专项。
 *
 * ## 刻意不覆盖的维度
 *
 *  - 768/1920 之外的中间宽度：断点由 Tailwind 的 sm/md/lg/xl 决定，这四个视口
 *    分别对应移动端 / md 边界 / 桌面默认 / 宽屏，已覆盖全部断点切换。
 *  - 动态详情路由只给了 /task/[id] 一条作范式（helpers 里已有 createTask）。
 *    其余 [aid]/[dbid]/[id]/[cid]/[mid] 需要先造实体，扩的时候照这条抄：
 *    先在 helpers.ts 加 createXxx，再把路径加进 DYNAMIC_ROUTES。
 *
 * 路由清单由 web/app/[locale]/w/[wid]/ 下的 page.tsx 生成（剔除含 [ 的动态段）：
 *   find "web/app/[locale]/w/[wid]" -name page.tsx | grep -v "\[" | sort
 *
 * 挂在 e2e/ 下即自动进入 CI 的「E2E (production build)」job。
 */

test.setTimeout(600_000);

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

/**
 * 响应式视口矩阵。四个宽度各有用意：
 *   375  手机（sm 以下）
 *   768  md 断点边界——layout.tsx 的桌面搜索按钮在 768 这一行从 hidden 变 md:flex，
 *        是布局切换点，最容易出错却又最不会被默认视口发现
 *   1280 桌面默认（playwright.config.ts 的 devices["Desktop Chrome"]）
 *   1920 宽屏
 */
const VIEWPORTS: readonly { width: number; height: number; label: string }[] = [
  { width: 375, height: 812, label: "375px 手机" },
  { width: 768, height: 1024, label: "768px md 边界" },
  { width: 1280, height: 800, label: "1280px 桌面" },
  { width: 1920, height: 1080, label: "1920px 宽屏" },
];

/** 路由级错误边界的唯一可见文案（error.pageError）。 */
const BOUNDARY_TEXT = "页面出错了";

test.describe.serial("路由健康门禁", () => {
  /** 每个测试现取唯一邮箱（与其他 spec 的隔离口径一致）。 */
  const uniqueEmail = () =>
    "e2e-route-health-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "@e2e.local";

  test("默认视口：36 条静态路由无错误边界 / 无未捕获异常 / 无 MISSING_MESSAGE", async ({
    page,
  }) => {
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
   * 四视口矩阵：无横向溢出 + 无错误边界。
   *
   * ## 为什么必须多视口（2026-10-17 P1-3 的教训）
   *
   * 上面那轮跑在 Playwright 默认视口（playwright.config.ts 用
   * devices["Desktop Chrome"] = 1280x720），**纯响应式缺陷在该宽度下完全不暴露**：
   * 工作区顶栏右簇在 375px 下越界 17.5px（scrollWidth=393 vs clientWidth=375），
   * 而 1280 下溢出 0px——1280 那一轮跑完整整 36 条路由都没发现它。
   *
   * 768 格外重要：它是 md 断点本身（layout.tsx 的桌面搜索按钮在 768 这一行
   * 从 hidden 切到 md:flex），是布局行为发生切换的那一行，最可能出问题，
   * 又最不会被桌面默认视口发现。
   *
   * 只断言溢出与错误边界两项：MISSING_MESSAGE / pageerror 与视口无关，
   * 已被上一轮覆盖。
   */
  test("四视口矩阵：无横向溢出 / 无错误边界（36 条静态路由 × 375/768/1280/1920）", async ({
    page,
  }) => {
    const wid = await registerAndLogin(page, uniqueEmail());

    const routeErrorLogs: string[] = [];
    page.on("console", (msg) => {
      const t = msg.text();
      if (t.includes("[route-error]")) routeErrorLogs.push(t.slice(0, 300));
    });

    /** 每条违规都是「视口 × 路由 × 溢出像素数」。 */
    const violations: string[] = [];

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of WORKSPACE_ROUTES) {
        await page.goto("/w/" + wid + route, { waitUntil: "load" });
        // 同上一轮：不能用 networkidle（心跳/轮询型页面永不可静默，会把 timeout 吃光）
        await page.waitForTimeout(1000);

        const m = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        const px = m.scrollWidth - m.clientWidth;
        if (px > 0) violations.push(`${vp.label}  ${route}  (溢出 ${px}px)`);

        const hit = await page
          .getByText(BOUNDARY_TEXT, { exact: true })
          .first()
          .isVisible()
          .catch(() => false);
        if (hit) {
          violations.push(
            `${vp.label}  ${route}  (崩到错误边界 <- ${routeErrorLogs.at(-1) ?? "(无 route-error 日志)"})`,
          );
        }
      }
    }

    expect(violations, `以下「视口 × 路由」存在横向溢出或崩溃：\n${violations.join("\n")}`).toEqual(
      [],
    );
  });

  /**
   * 动态详情路由：/task/[id]。
   *
   * 静态路由清单刻意剔除了含 [ 的动态段，因为要先造实体。本测试补上这一层，
   * 并作为后续扩展其余 [aid]/[dbid]/[id]/[cid]/[mid] 的范式：
   * helpers.ts 已有 createTask 返回真实 id，直接拿来导航。
   *
   * 断言错误边界 + 未捕获异常 + MISSING_MESSAGE；不测内容正确性（那是各功能
   * spec 的职责），只测「这条路能通、不崩」。
   */
  test("动态详情路由 /task/[id]：不崩、无异常、无原始 key", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail());

    const pageErrors: string[] = [];
    const missingMessages: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.name + ": " + err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("MISSING_MESSAGE")) {
        missingMessages.push(msg.text());
      }
    });

    const taskId = await createTask(page, `e2e-route-health-detail-${Date.now()}`);
    expect(taskId, "createTask 未返回任务 id").toBeTruthy();

    await page.goto(`/w/${wid}/task/${taskId}`, { waitUntil: "load" });
    await page.waitForTimeout(1000);

    const hit = await page
      .getByText(BOUNDARY_TEXT, { exact: true })
      .first()
      .isVisible()
      .catch(() => false);
    expect(hit, `/task/${taskId} 崩到路由级错误边界`).toBe(false);

    const errMsg = pageErrors.length
      ? "存在未捕获异常（pageerror）：" + [...new Set(pageErrors)].slice(0, 10).join("\n")
      : "";
    expect(pageErrors, errMsg).toEqual([]);

    const missMsg = missingMessages.length
      ? "存在 MISSING_MESSAGE：" + [...new Set(missingMessages)].slice(0, 10).join("\n")
      : "";
    expect([...new Set(missingMessages)], missMsg).toEqual([]);
  });
});
