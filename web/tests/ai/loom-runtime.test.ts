import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLoomRuntimeUrl, createLoomDailyReportStream } from "@/lib/ai/loom-runtime";

const stages = {
  context: "聚合",
  analyzing: "分析",
  generating: "生成",
};

function params(buildPrompt = async () => "业务上下文") {
  return {
    baseUrl: "https://runtime.example.com",
    system: "系统提示",
    buildPrompt,
    title: "工作区日报",
    stages,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loom daily-report runtime adapter", () => {
  it("POSTs office-daily-report and preserves progress + text stream", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ output_content: "# 日报\n完成 A" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // 随机测试 token，避免把任何凭据写进仓库。
    const apiKey = crypto.randomUUID();
    vi.stubEnv("LOOM_TEST_API_KEY", apiKey);

    const response = createLoomDailyReportStream({
      ...params(),
      apiKey: process.env.LOOM_TEST_API_KEY,
    });
    const text = await response.text();

    expect(text).toContain('"type":"data-progress"');
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain("完成 A");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://runtime.example.com/api/tasks");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.pipeline).toBe("office-daily-report");
    expect(body.wait).toBe(true);
    expect(body.query).toContain("系统提示");
    expect(body.query).toContain("业务上下文");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${apiKey}`);
  });

  it("does not send Authorization when apiKey is absent", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ output_content: "正文" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createLoomDailyReportStream(params()).text();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("surfaces runtime failures instead of silently falling back", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await createLoomDailyReportStream(params()).text();
    expect(text).toContain('"type":"error"');
    expect(text).not.toContain('"type":"text-delta"');
  });

  it("rejects loopback/private/non-http runtime URLs before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const url of ["http://127.0.0.1:8910", "http://localhost:8910", "ftp://example.com"]) {
      expect(() => assertLoomRuntimeUrl(url)).toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assertLoomRuntimeUrl("https://runtime.example.com/")).toBe(
      "https://runtime.example.com",
    );
  });
});
