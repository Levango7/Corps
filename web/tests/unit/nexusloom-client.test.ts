// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * nexusloom 客户端封装契约（lib/ai/nexusloom.ts）：
 *  1. title 归属编码/解码（[loom:<wid>] 前缀往返一致；无前缀回退）
 *  2. 任务 id 白名单（路径拼接注入阻断）
 *  3. sidecar 不可达 → LoomUnavailableError（路由层转 502 + 明确文案）
 *  4. env 覆盖 host 只允许回环/私网（fail-closed 退回默认回环端点）
 */

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);

describe("nexusloom 客户端", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.fetch.mockReset();
  });

  it("title 编码/解码往返一致，无前缀文本 wid=null", async () => {
    const mod = await import("@/lib/ai/nexusloom");
    const wid = "0b3d1f14-1111-4222-8333-444455556666";
    const encoded = mod.encodeLoomTitle(wid, "敏捷落地指引");
    expect(encoded.startsWith(`[loom:${wid}] `)).toBe(true);
    const decoded = mod.decodeLoomTitle(encoded);
    expect(decoded.wid).toBe(wid);
    expect(decoded.title).toBe("敏捷落地指引");
    // 无前缀（外部直接建的 sidecar 任务）不误判归属
    const bare = mod.decodeLoomTitle("some external title");
    expect(bare.wid).toBeNull();
    expect(bare.title).toBe("some external title");
  });

  it("任务 id 白名单：非法字符抛 LoomUnavailableError", async () => {
    const mod = await import("@/lib/ai/nexusloom");
    expect(() => mod.assertSafeLoomId("../etc/passwd")).toThrow(mod.LoomUnavailableError);
    expect(() => mod.assertSafeLoomId("a".repeat(129))).toThrow(mod.LoomUnavailableError);
    expect(mod.assertSafeLoomId("task_A-b-123")).toBe("task_A-b-123");
  });

  it("HTTP 非 2xx → LoomUnavailableError（路由层据此 502）", async () => {
    mocks.fetch.mockResolvedValue(new Response("boom", { status: 503 }));
    const mod = await import("@/lib/ai/nexusloom");
    await expect(mod.listLoomTasks()).rejects.toThrow(mod.LoomUnavailableError);
  });

  it("网络层异常（fetch reject）同样归一为 LoomUnavailableError", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("fetch failed"));
    const mod = await import("@/lib/ai/nexusloom");
    await expect(mod.getLoomTask("task-1")).rejects.toThrow(mod.LoomUnavailableError);
  });

  it("host 白名单：公网地址 fail-closed 退回默认回环端点", async () => {
    process.env.NEXUSLOOM_URL = "http://169.254.169.254/latest/meta-data";
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const mod = await import("@/lib/ai/nexusloom");
    await mod.loomHealthy();
    const called = mocks.fetch.mock.calls[0]?.[0] as string;
    expect(called.startsWith("http://127.0.0.1:8910")).toBe(true);
    delete process.env.NEXUSLOOM_URL;
  });

  it("私网 host 允许 env 覆盖", async () => {
    process.env.NEXUSLOOM_URL = "http://192.168.1.10:8910";
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const mod = await import("@/lib/ai/nexusloom");
    await mod.loomHealthy();
    const called = mocks.fetch.mock.calls[0]?.[0] as string;
    expect(called.startsWith("http://192.168.1.10:8910")).toBe(true);
    delete process.env.NEXUSLOOM_URL;
  });

  it("提交使用 60s 有界超时，不再被普通读取的 15s 提前截断", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ task_id: "task-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const mod = await import("@/lib/ai/nexusloom");
    await expect(mod.submitLoomTask({ query: "test", pipeline: "docgen-review" })).resolves.toEqual(
      {
        task_id: "task-1",
      },
    );
    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    timeoutSpy.mockRestore();
  });
});
