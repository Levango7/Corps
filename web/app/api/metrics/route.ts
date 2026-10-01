import { NextRequest, NextResponse } from "next/server";
import { apiMsg } from "@/lib/api-messages";

/**
 * Prometheus 指标端点 — /api/metrics
 *
 * 输出 Prometheus exposition format 文本：
 * - corps_uptime_seconds: 进程运行时间
 * - corps_memory_rss_bytes: RSS 内存使用
 * - corps_memory_heap_used_bytes: 堆内存使用
 * - corps_node_version: Node.js 版本（info metric）
 *
 * 注意：默认不要求认证（Prometheus scraper 无 cookie），生产应通过网络层
 * （防火墙/ingress）限制访问；若需端点级控制，设置 METRICS_TOKEN 后即要求
 * `Authorization: Bearer <token>`（见 docs/runbook-deploy.md §8.2）。
 */

export async function GET(req: NextRequest) {
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
  ].join("\n");

  return new NextResponse(metrics, {
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
