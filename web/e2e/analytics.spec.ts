import { expect, test } from "@playwright/test";
import { createTask, registerAndLogin, uniqueEmail } from "./helpers";

// 分析域：只读仪表盘，唯一交互面是错误态重试按钮（本批不制造假 500，不覆盖）。
// 覆盖=真实数据链：注册落 register_success + 建任务落 create_task（均服务端同步埋点，
// 见 app/api/v1/auth/register/route.ts 与 tasks/route.ts 的 trackServerEvent），概览页聚合渲染。
// 成员 403 边界：owner 邀请 member 后直访分析页，requirePermission 门禁返 403，
// ErrorState 按 ApiError.status 走 needAdmin 分支（zh 文案「禁止访问」不命中英文正则的旧缺陷已修）。
test.describe("分析：概览仪表盘真实数据渲染", () => {
  test("新工作区壳层 + 注册事件落漏斗/热门事件", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-ana"), "E2E分析工作区");
    await page.goto(`/w/${wid}/analytics`);
    // 页头：h1 分析 + 副标题 14 天窗口
    await expect(page.getByRole("heading", { name: "分析", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("最近 14 天的用户行为漏斗与趋势。", { exact: true })).toBeVisible();
    // 周活跃卡 + 概览卡标签
    for (const label of [
      "本工作区本周活跃人数（核心事件）",
      "事件总数",
      "核心活跃",
      "会话数",
      "日均事件",
      "活跃用户",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // 两段漏斗标题与描述（apiMsg 按请求 locale 现取的中文标签）
    await expect(page.getByText("获客段漏斗", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "landing_view → click_signup → register_submit → register_success（按 sessionId 串联）",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText("激活段漏斗", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "register_success → create_task → activation_completed（按 userId 串联，15 分钟窗口）",
        { exact: true },
      ),
    ).toBeVisible();
    // 留存区：三观察点 + 公式注脚
    await expect(page.getByText("留存回访率", { exact: true })).toBeVisible();
    for (const p of ["次日", "7 日", "30 日"]) {
      await expect(page.getByText(p, { exact: true })).toBeVisible();
    }
    await expect(
      page.getByText(
        "D_n 回访率 ＝ 注册后第 n 个 Asia/Shanghai 自然日产生 ≥1 次核心行为的用户数 ÷ 注册满 n 天的用户数。",
        { exact: true },
      ),
    ).toBeVisible();
    // 趋势图（svg role=img）与热门事件区；注册事件真实落库 → 热门事件含 register_success
    await expect(page.getByRole("img", { name: "趋势图表" })).toBeVisible();
    await expect(page.getByText("热门事件", { exact: true })).toBeVisible();
    await expect(page.locator("code", { hasText: "register_success" })).toBeVisible();
    // 周起始注脚（周一 00:00 UTC+8 口径）
    await expect(page.getByText(/周起始 \d{4}-\d{2}-\d{2}（周一 00:00 UTC\+8）/)).toBeVisible();
  });

  test("建任务后 create_task 进入热门事件与趋势图", async ({ page }) => {
    test.setTimeout(120_000);
    const wid = await registerAndLogin(page, uniqueEmail("e2e-ana"), "E2E分析工作区");
    const title = `E2E分析任务-${Date.now()}`;
    await createTask(page, title);
    await page.goto(`/w/${wid}/analytics`);
    // 两段真实行为事件都在热门事件列表（code 元素渲染事件名原文）
    await expect(page.locator("code", { hasText: "create_task" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("code", { hasText: "register_success" })).toBeVisible();
    // 有数据则不渲染「暂无数据」空态（趋势/热门事件两处分用同一文案）
    await expect(page.getByText("暂无数据", { exact: true })).toHaveCount(0);
    // 趋势折线 svg 仍挂网
    await expect(page.getByRole("img", { name: "趋势图表" })).toBeVisible();
  });

  test("普通成员直访分析页：403 落 needAdmin 权限提示且无重试按钮", async ({ page, browser }) => {
    // 双账号夹具（沿用 viewer-readonly.spec.ts 的多 context 惯例）：
    // B 先注册（邀请链对已注册受邀者走事务内直建成员，免一次性 token 邮件链路），
    // 再由 A 以 owner 身份邀请进 A 的工作区，角色 member。
    test.setTimeout(120_000);
    const memberCtx = await browser.newContext({ locale: "zh-CN" });
    const mp = await memberCtx.newPage();
    const memberEmail = uniqueEmail("e2e-ana-member");
    await registerAndLogin(mp, memberEmail, "成员自有工作区");

    const ownerEmail = uniqueEmail("e2e-ana-owner");
    const wid = await registerAndLogin(page, ownerEmail, "E2E分析权限工作区");
    const invite = await page.request.post(`/api/v1/workspaces/${wid}/members/invite`, {
      data: { email: memberEmail, role: "member" },
    });
    expect(invite.status(), "owner 邀请成员应成功").toBe(201);

    // B 直访 A 的分析页：API 层 requirePermission 返 403，前端按 ApiError.status 走权限不足分支
    await mp.goto(`/w/${wid}/analytics`);
    await expect(mp.getByText("需要管理员权限", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(mp.getByText("仅拥有者或管理员可查看分析数据。", { exact: true })).toBeVisible();
    // 反证：非 403 分支的文案与重试按钮均不可见（旧实现 zh 落此处＝重试永远 403 空转）
    await expect(mp.getByText("加载失败", { exact: true })).toHaveCount(0);
    await expect(mp.getByRole("button", { name: "重试" })).toHaveCount(0);

    await memberCtx.close();
  });
});
