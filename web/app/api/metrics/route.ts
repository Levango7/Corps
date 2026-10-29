import { NextRequest, NextResponse } from "next/server";
import { apiMsg } from "@/lib/api-messages";
import { redMetricsText, withRed } from "@/lib/red-metrics";

/**
 * Prometheus 指标端点 — /api/metrics
 *
 * 输出 Prometheus exposition format 文本：
 * - corps_uptime_seconds: 进程运行时间
 * - corps_memory_rss_bytes: RSS 内存使用
 * - corps_memory_heap_used_bytes: 堆内存使用
 * - corps_node_version: Node.js 版本（info metric）
 * - corps_http_requests_total{route}          按路由请求数（RED 的 R）
 * - corps_http_request_errors_total{route}    按路由未处理错误数（RED 的 E）
 * - corps_http_request_duration_ms{route}     按路由耗时直方图（RED 的 D）
 *
 * 关于 RED 三维的接线现状（不要只看 series 名就以为都通了）：
 *   - Errors：已接通。数据源是 instrumentation.ts 的 onRequestError 钩子。
 *   - Requests / Duration：已对首批路由接通（2026-10-26 起 contacts /
 *     announcements / activity 三个域，逐路由 `withRed()` 包装）——
 *     这三个域的请求会吐出 corps_http_requests_total 与
 *     corps_http_request_duration_ms 序列；未接线路由不会出现。
 *     middleware 跑在 Edge runtime 状态不共享、App Router 无全局钩子的约束
 *     不变，后续按目录分批推进，详见 web/lib/red-metrics.ts 顶部。
 *
 * 注意：默认不要求认证（Prometheus scraper 无 cookie），生产应通过网络层
 * （防火墙/ingress）限制访问；若需端点级控制，设置 METRICS_TOKEN 后即要求
 * `Authorization: Bearer <token>`（见 docs/runbook-deploy.md §8.2）。
 */

async function getMetrics(req: NextRequest) {
  // 可选令牌门：设置了 METRICS_TOKEN 才校验，未设置维持开放的"网络层负责"姿态。
  const metricsToken = process.env.METRICS_TOKEN;
  if (metricsToken && req.headers.get("authorization") !== `Bearer ${metricsToken}`) {
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );
  }

  const mem = process.memoryUsage();
  const uptime = process.uptime();

  const metrics = [
    // HELP/TYPE 声明
    "# HELP corps_uptime_seconds Process uptime in seconds",
    "# TYPE corps_uptime_seconds gauge",
    `corps_uptime_seconds ${uptime.toFixed(2)}`,
    "",

    "# HELP corps_memory_rss_bytes Resident Set Size memory in bytes",
    "# TYPE corps_memory_rss_bytes gauge",
    `corps_memory_rss_bytes ${mem.rss}`,
    "",

    "# HELP corps_memory_heap_used_bytes Used heap memory in bytes",
    "# TYPE corps_memory_heap_used_bytes gauge",
    `corps_memory_heap_used_bytes ${mem.heapUsed}`,
    "",

    "# HELP corps_memory_heap_total_bytes Total heap memory in bytes",
    "# TYPE corps_memory_heap_total_bytes gauge",
    `corps_memory_heap_total_bytes ${mem.heapTotal}`,
    "",

    "# HELP corps_memory_external_bytes External memory in bytes",
    "# TYPE corps_memory_external_bytes gauge",
    `corps_memory_external_bytes ${mem.external}`,
    "",

    "# HELP corps_node_version Node.js version info",
    "# TYPE corps_node_version gauge",
    `corps_node_version{version="${process.version.replace(/^v/, "")}"} 1`,
    "",

    "# HELP corps_process_pid Process ID",
    "# TYPE corps_process_pid gauge",
    `corps_process_pid ${process.pid}`,
  ];

  // RED 指标：按路由的请求数 / 错误数 / 耗时。空注册表时 redMetricsText()
  // 返回空串，此时不追加空块，避免 exposition 里出现孤立的 HELP/TYPE 声明。
  const red = redMetricsText();
  if (red) metrics.push("", red);

  const body = metrics.join("\n");

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const GET = withRed(getMetrics);
