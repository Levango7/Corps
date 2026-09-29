import { describe, it, expect } from "vitest";
import { BASE, registerUser, authHeader } from "../helpers";

/**
 * 仪表盘 Widget 端点契约集成测试
 *
 * 回归背景：动态路由曾把载荷多包一层 `{ code:200, data: { widget, data } }`，
 * 而 11 个 widget 组件、3 个专用路由（gantt-chart / milestone-timeline / custom-chart）
 * 与 api/openapi.yaml 的 Envelope_WidgetData 都按「data 直接是载荷」消费——
 * 结果所有 widget 读到 undefined，把工作区概览页打进错误边界
 * （E2E 表现为找不到「新建任务」按钮而超时）。
 *
 * 此处钉死形状契约，防止再次出现"改了一侧忘了另一侧"。
 */
describe("dashboard widget 端点：data 即载荷（无 {widget,data} 二层包装）", () => {
  it("recent-activity 返回 data.items 数组", async () => {
    const { workspace, accessToken } = await registerUser({ prefix: "wgt-act" });

    const res = await fetch(
      `${BASE}/workspaces/${workspace.id}/dashboard/widgets/recent-activity`,
      { headers: authHeader(accessToken) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.code).toBe(200);
    // 关键断言：data 就是载荷本体
    expect(Array.isArray(json.data?.items)).toBe(true);
    // 不应再出现旧的二层包装
    expect(json.data?.widget).toBeUndefined();
    expect(json.data?.data).toBeUndefined();
  });

  it("task-stats 返回状态计数与 total", async () => {
    const { workspace, accessToken } = await registerUser({ prefix: "wgt-stats" });

    const res = await fetch(`${BASE}/workspaces/${workspace.id}/dashboard/widgets/task-stats`, {
      headers: authHeader(accessToken),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      todo: expect.any(Number),
      in_progress: expect.any(Number),
      review: expect.any(Number),
      done: expect.any(Number),
      total: expect.any(Number),
    });
    expect(json.data?.widget).toBeUndefined();
  });

  it("burndown 返回 days 数组（燃尽图按日取数）", async () => {
    const { workspace, accessToken } = await registerUser({ prefix: "wgt-burn" });

    const res = await fetch(`${BASE}/workspaces/${workspace.id}/dashboard/widgets/burndown`, {
      headers: authHeader(accessToken),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(json.data?.days)).toBe(true);
  });

  it("未知 widgetId 返回 404（白名单外）", async () => {
    const { workspace, accessToken } = await registerUser({ prefix: "wgt-404" });

    const res = await fetch(`${BASE}/workspaces/${workspace.id}/dashboard/widgets/not-a-widget`, {
      headers: authHeader(accessToken),
    });

    expect(res.status).toBe(404);
  });
});
