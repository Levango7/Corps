import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/metrics/route";

/**
 * /api/metrics 可选令牌门单元测试
 *
 * 覆盖 web/app/api/metrics/route.ts 的 METRICS_TOKEN 门：
 *  - 未设置 METRICS_TOKEN：维持开放姿态（Prometheus scraper 无 cookie），200 + 指标文本
 *  - 设置后：缺 Authorization / Bearer 错误 → 401 JSON 信封，且响应不泄露指标
 *  - 设置后：Bearer 正确 → 200
 *
 * 门"跳过与放行"的判据是 process.env.METRICS_TOKEN 的真值，测试用 vi.stubEnv
 * 控制，afterEach 统一恢复，避免用例间串扰。
 */

const URL = "http://localhost:3000/api/metrics";
const TOKEN = "test-metrics-token";

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest(URL, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/metrics - METRICS_TOKEN 令牌门", () => {
  it("未设置 METRICS_TOKEN 时开放访问（200 + 指标文本）", async () => {
    // Arrange：空串与未设置同为 falsy，走"门跳过"分支
    vi.stubEnv("METRICS_TOKEN", "");

    // Act
    const res = await GET(makeReq());

    // Assert
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("corps_uptime_seconds");
    expect(body).toContain("# TYPE corps_memory_rss_bytes gauge");
  });

  it("设置 METRICS_TOKEN 后缺 Authorization 时 401，且不返回指标", async () => {
    // Arrange
    vi.stubEnv("METRICS_TOKEN", TOKEN);

    // Act
    const res = await GET(makeReq());

    // Assert
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe(401);
    expect(JSON.stringify(body)).not.toContain("corps_");
  });

  it("设置 METRICS_TOKEN 后 Bearer 错误时 401", async () => {
    // Arrange
    vi.stubEnv("METRICS_TOKEN", TOKEN);

    // Act
    const res = await GET(makeReq({ authorization: "Bearer wrong-token" }));

    // Assert
    expect(res.status).toBe(401);
  });

  it("设置 METRICS_TOKEN 后 Bearer 正确时 200", async () => {
    // Arrange
    vi.stubEnv("METRICS_TOKEN", TOKEN);

    // Act
    const res = await GET(makeReq({ authorization: `Bearer ${TOKEN}` }));

    // Assert
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("corps_uptime_seconds");
  });
});
