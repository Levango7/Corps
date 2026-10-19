import { expect, test } from "@playwright/test";
import { registerAndLogin, uniqueEmail } from "./helpers";

/**
 * 接口健康门禁（API Health Gate）：页面渲染期间发出的接口请求不得返回 5xx。
 *
 * ## 为什么需要它（与路由健康门禁互补，不是重复）
 *
 * `route-health.spec.ts` 守的是**页面会不会崩**：错误边界、未捕获异常、
 * MISSING_MESSAGE、横向溢出。但它看不见**接口层**的失败——服务端 500 时，
 * 前端通常优雅降级（弹个 toast、列表空着），页面照样渲染得好好的，错误边界
 * 根本不会被触发。于是「接口在 500，而所有门禁全绿」是可以同时成立的。
 *
 * 2026-10-17 就出现过这种形态：QA 实测扫出 4 条 500，落在
 * `conversations` / `notifications` / `tasks` 三个端点上，而当时 CI 12 项
 * 必需检查一道都没红。事后查明那批 500 是本地 DB 容器 `Exited` 后重启造成的
 * 环境性故障（不是代码缺陷），但它暴露的结构性问题是真的：
 * **"接口 500" 这个信号在浏览器层没有任何守卫在听。**
 *
 * ## 断言的取值边界（刻意只钉 5xx）
 *
 * 只判 `>= 500`。4xx 一律放过：401/403/404 在页面加载期间是**合法**的
 * ——未登录探测、可选资源不存在、权限不足的模块不渲染，都会正常返回 4xx。
 * 把它们也当红会让这道门禁立刻充满噪音并被人关掉，那就等于没有。
 *
 * ## 反空转：必须证明"确实观测到了请求"
 *
 * 只断言「没有 5xx」是不够的——如果 listener 挂晚了、URL 口径写错了、
 * 或者页面压根没发请求，断言会**恒绿且什么都没测**。这与
 * `route-health.spec.ts` 动态路由那条曾经踩过的坑同源（拿标题当 id 拼
 * URL，落到 404 页，三条断言全过）。所以这里加一条阳性断言：
 * 观测到的 `/api/v1` 响应数必须大于零。没有这一条，本文件就没有意义。
 *
 * ## 为什么只扫这几个页面
 *
 * 扫的是**会真实发起接口请求**的页面。36 条静态路由的全景遍历属
 * `route-health.spec.ts` 的职责（那边有 36 × 4 视口的矩阵）；这里是接口层，
 * 覆盖面按"发请求的入口"选，不按"路由清单"选。加页面时照抄即可：
 * 挑一个打开就会打接口的路径，塞进 API_HEAVY_ROUTES。
 *
 * ⛔ 不能用 `waitForLoadState("networkidle")`：`/im` 与概览页挂了在线成员心跳
 * （POST /presence），网络永远静默不下来。用固定稳态窗口。
 */

test.setTimeout(300_000);

/**
 * 会真实发起接口请求的页面。
 *
 *  `/`        概览页：多个 widget 并发拉数据（任务/活动/AI 洞察/在线成员）
 *  `/im`      会话列表——历史 500 现场之一（`conversations?limit=100`）
 *  `/notifications` 未读计数——历史 500 现场之一（`?count=true`）
 *  `/board`   看板：任务 + 成员 + 标签 + 里程碑并发拉取
 *  `/my-tasks` 我的任务：任务列表 + 统计
 *  `/documents` 云盘：文档树 + 分享状态
 *  `/settings` 设置：成员、角色、权限矩阵、计费状态
 */
const API_HEAVY_ROUTES: readonly string[] = [
  "/",
  "/im",
  "/notifications",
  "/board",
  "/my-tasks",
  "/documents",
  "/settings",
];

test.describe.serial("接口健康门禁", () => {
  test("渲染关键页面时 /api/v1 不得返回 5xx", async ({ page }) => {
    const wid = await registerAndLogin(page, uniqueEmail());

    /** 观测到的 5xx：`METHOD status path?query`。 */
    const serverErrors: string[] = [];
    /** 观测到的全部 /api/v1 响应数——反空转用（见文件头）。 */
    let observed = 0;

    // listener 必须在首次导航之前挂上，否则漏掉首批并发请求
    page.on("response", (res) => {
      // data:/blob: 之类也会进 response 事件，new URL 对它们能解析但没有
      // pathname 语义；统一用 try 兜住，避免 listener 内抛异常把整个测试
      // 变成一个看不懂的 unhandled rejection。
      let url: URL;
      try {
        url = new URL(res.url());
      } catch {
        return;
      }
      if (!url.pathname.includes("/api/v1/")) return;
      observed += 1;
      const status = res.status();
      if (status >= 500) {
        serverErrors.push(`${res.request().method()} ${status} ${url.pathname}${url.search}`);
      }
    });

    for (const route of API_HEAVY_ROUTES) {
      await page.goto(`/w/${wid}${route}`, { waitUntil: "load" });
      // 固定稳态窗口：等 XHR 落地。不能用 networkidle（心跳型页面永不静默）
      await page.waitForTimeout(1200);
    }

    // 反空转：证明这道门禁真的在听
    expect(
      observed,
      "整轮没观测到任何 /api/v1 响应——listener 或 URL 口径失效，此时「无 5xx」是假绿",
    ).toBeGreaterThan(0);

    expect(
      serverErrors,
      `页面渲染期间以下接口返回了 5xx（页面可能优雅降级了，所以错误边界看不见它）：\n` +
        [...new Set(serverErrors)].join("\n"),
    ).toEqual([]);
  });
});
