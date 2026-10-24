import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/metrics/route";
import {
  normalizeRoute,
  recordError,
  recordRequest,
  recordDuration,
  withRed,
  redMetricsText,
  redRouteCount,
  resetRedMetrics,
} from "@/lib/red-metrics";

/**
 * 按路由 RED 指标单元测试（web/lib/red-metrics.ts + /api/metrics 接线）
 *
 * 重点不是"文件存在"，而是**指标真的能从 /api/metrics 吐出来**：
 * 最后两组用例直接调 GET 处理器，断言响应体里出现 RED series。
 * 只断言模块函数行为的测试，证明不了接线。
 *
 * 覆盖：
 *  - normalizeRoute：uuid / 24 位 hex / 纯数字段折叠成 [id]，真实段不动，
 *    查询串剥掉（基数控制 —— 具体 URL 全是 uuid，不折叠会打爆 Prometheus）
 *  - recordError：按路由独立计数，exposition 格式正确
 *  - withRed：5xx 记错误、4xx 不记、抛异常也记并继续上抛
 *  - /api/metrics：注册表非空时真的带上 RED series；只有错误时不出孤立直方图
 *  - 基数上限：超过 MAX_ROUTES 后新路由被丢弃，已登记的不受影响
 */

const URL = "http://localhost:3000/api/metrics";

afterEach(() => {
  vi.unstubAllEnvs();
  resetRedMetrics();
});

describe("normalizeRoute — 基数控制", () => {
  it("uuid 段折叠成 [id]", () => {
    expect(
      normalizeRoute("/api/v1/workspaces/3f2a9c11-4b7e-4a1d-9c33-8d5e6f7a8b90/tasks"),
    ).toBe("/api/v1/workspaces/[id]/tasks");
  });

  it("24 位十六进制与纯数字段同样折叠", () => {
    expect(normalizeRoute("/api/v1/databases/507f1f77bcf86cd799439011/records")).toBe(
      "/api/v1/databases/[id]/records",
    );
    expect(normalizeRoute("/api/v1/things/12345")).toBe("/api/v1/things/[id]");
  });

  it("真实路径段保持原样，不误折叠", () => {
    expect(normalizeRoute("/api/v1/workspaces/abc/tasks/batch-export")).toBe(
      "/api/v1/workspaces/abc/tasks/batch-export",
    );
  });

  it("剥掉查询串 —— 否则同一路由按 query 分裂成无数标签", () => {
    expect(normalizeRoute("/api/v1/tasks?cursor=1&limit=50")).toBe("/api/v1/tasks");
  });
});

describe("recordError — Errors 一维", () => {
  it("按路由独立计数，输出 Prometheus counter 格式", () => {
    recordError({ route: "/api/v1/tasks", method: "POST" });
    recordError({ route: "/api/v1/tasks", method: "POST" });
    recordError({ route: "/api/v1/approvals", method: "PATCH" });

    const text = redMetricsText();
    expect(text).toContain("# TYPE corps_http_request_errors_total counter");
    expect(text).toContain('corps_http_request_errors_total{route="/api/v1/tasks"} 2');
    expect(text).toContain('corps_http_request_errors_total{route="/api/v1/approvals"} 1');
  });

  it("注册表为空时输出空串（不产生孤立 HELP/TYPE 声明）", () => {
    expect(redMetricsText()).toBe("");
  });
});

describe("withRed — Rate/Duration/按状态码的错误", () => {
  it("成功请求记录 requests 与 duration，不出错误", async () => {
    const handler = withRed(async (_req: Request) => new Response("ok", { status: 200 }));

    await handler(
      new Request("http://localhost:3000/api/v1/workspaces/3f2a9c11-4b7e-4a1d-9c33-8d5e6f7a8b90/tasks"),
    );

    const text = redMetricsText();
    expect(text).toContain('corps_http_requests_total{route="/api/v1/workspaces/[id]/tasks"} 1');
    expect(text).toContain("# TYPE corps_http_request_duration_ms histogram");
    expect(text).toContain('corps_http_request_duration_ms_count{route="/api/v1/workspaces/[id]/tasks"} 1');
    expect(text).not.toContain("corps_http_request_errors_total");
  });

  it("5xx 记为错误", async () => {
    const handler = withRed(async (_req: Request) => new Response("boom", { status: 503 }));

    const res = await handler(new Request("http://localhost:3000/api/v1/tasks"));

    expect(res.status).toBe(503);
    expect(redMetricsText()).toContain('corps_http_request_errors_total{route="/api/v1/tasks"} 1');
  });

  it("4xx 不记为错误 —— 客户端错误不是服务端故障", async () => {
    const handler = withRed(async (_req: Request) => new Response("no", { status: 404 }));

    await handler(new Request("http://localhost:3000/api/v1/tasks"));

    expect(redMetricsText()).not.toContain("corps_http_request_errors_total");
  });

  it("抛异常时既记错误又继续上抛（不吞异常）", async () => {
    const handler = withRed(async (_req: Request) => {
      throw new Error("kaboom");
    });

    await expect(handler(new Request("http://localhost:3000/api/v1/tasks"))).rejects.toThrow(
      "kaboom",
    );
    expect(redMetricsText()).toContain('corps_http_request_errors_total{route="/api/v1/tasks"} 1');
  });

  it("耗时分桶累计正确（0.5ms 落 le=1 桶，900ms 落 le=2500 桶）", () => {
    // 桶边界是 [1,5,25,100,500,2500,10000] 毫秒 —— 没有 1000 这一档，
    // 900ms 落在 2500 档。断言完整的累计序列，而不是只挑一两个桶。
    recordDuration({ route: "/r", durationMs: 0.5 });
    recordDuration({ route: "/r", durationMs: 900 });

    const text = redMetricsText();
    // 注意每个条目自带收尾的 `}` —— label 块是 {route="...",le="..."}
    const expected = [
      'le="1"} 1',
      'le="5"} 1',
      'le="25"} 1',
      'le="100"} 1',
      'le="500"} 1',
      'le="2500"} 2',
      'le="10000"} 2',
      'le="+Inf"} 2',
    ];
    for (const e of expected) {
      expect(text).toContain(`corps_http_request_duration_ms_bucket{route="/r",${e}`);
    }
    expect(text).toContain('corps_http_request_duration_ms_count{route="/r"} 2');
    expect(text).toContain('corps_http_request_duration_ms_sum{route="/r"} 900.5');
  });
});

describe("/api/metrics 端点真的带上 RED series", () => {
  it("注册表非空时响应体包含 RED 指标", async () => {
    // 这组用例证明的是**接线**，不是模块行为：直接打 GET 处理器。
    vi.stubEnv("METRICS_TOKEN", "");
    recordError({ route: "/api/v1/tasks", method: "POST" });

    const res = await GET(new NextRequest(URL));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("corps_uptime_seconds"); // 原有进程级指标仍在
    expect(body).toContain('corps_http_request_errors_total{route="/api/v1/tasks"} 1');
  });

  it("只记了错误时不出耗时直方图（没有孤立 HELP/TYPE）", async () => {
    vi.stubEnv("METRICS_TOKEN", "");
    recordError({ route: "/api/v1/tasks" });

    const body = await (await GET(new NextRequest(URL))).text();

    expect(body).not.toContain("corps_http_request_duration_ms");
  });

  it("401 分支不泄露任何指标（含 RED）", async () => {
    vi.stubEnv("METRICS_TOKEN", "tok");
    recordError({ route: "/api/v1/tasks" });

    const res = await GET(new NextRequest(URL));
    const blob = JSON.stringify(await res.json());

    expect(res.status).toBe(401);
    expect(blob).not.toContain("corps_");
  });
});

describe("基数上限 — 防止 uuid 打爆注册表", () => {
  it("超过上限后新路由被丢弃，已登记路由不受影响", () => {
    for (let i = 0; i < 600; i += 1) {
      recordRequest({ route: `/api/v1/r${i}` });
    }
    // 前 500 个成功登记，之后的被拒
    expect(redRouteCount()).toBe(500);

    recordRequest({ route: "/api/v1/r0" });
    expect(redMetricsText()).toContain('corps_http_requests_total{route="/api/v1/r0"} 2');
  });
});
