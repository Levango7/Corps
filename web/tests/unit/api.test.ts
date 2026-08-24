import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * API 客户端单元测试
 *
 * 覆盖 web/lib/api.ts 的 api 函数：
 *  - 正确拼接 URL（透传 path 给 fetch）
 *  - 正确设置 headers（自动注入 Content-Type: application/json）
 *  - 正确处理 JSON body（透传 + credentials: include）
 *  - 正确处理错误响应（抛出 message 或 fallback）
 *  - 正确处理网络错误（fetch reject 透传）
 *  - 401 自动 refresh 并重试
 *
 * 通过 vi.spyOn(globalThis, "fetch") mock 全局 fetch，
 * 不依赖真实网络与 dev server。
 */

import { api } from "@/lib/api";

/** 构造一个最小 Response-like 对象（避免完整 Response 构造的兼容问题） */
function mockResponse(
  body: unknown,
  init: { status?: number; ok?: boolean; statusText?: string } = {},
): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  const jsonStr = JSON.stringify(body);
  return {
    ok,
    status,
    statusText: init.statusText ?? "",
    json: async () => JSON.parse(jsonStr),
    text: async () => jsonStr,
  } as Response;
}

// 用 vi.fn() 的 MockInstance 类型，兼容 spyOn 的重载签名
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch") as unknown as ReturnType<typeof vi.fn>;
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("api 客户端 - URL 与 headers 处理", () => {
  it("以传入的 path 原样调用 fetch（透传 URL）", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(mockResponse({ data: { ok: true } }));

    // Act
    await api("/api/v1/tasks");

    // Assert
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/v1/tasks");
  });

  it("有 body 但未设置 Content-Type 时自动注入 application/json", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(mockResponse({ data: null }));
    const body = JSON.stringify({ title: "t" });

    // Act
    await api("/api/v1/tasks", { method: "POST", body });

    // Assert
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("调用方已设置的 Content-Type 不被覆盖", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(mockResponse({ data: null }));
    const body = JSON.stringify({ x: 1 });

    // Act
    await api("/api/v1/tasks", {
      method: "POST",
      body,
      headers: { "Content-Type": "text/plain" },
    });

    // Assert
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("text/plain");
  });

  it("无 body 时不自动注入 Content-Type", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(mockResponse({ data: null }));

    // Act
    await api("/api/v1/tasks", { method: "GET" });

    // Assert
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("始终携带 credentials: include（依赖 httpOnly cookie）", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(mockResponse({ data: null }));

    // Act
    await api("/api/v1/tasks");

    // Assert
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
  });
});

describe("api 客户端 - body 处理", () => {
  it("JSON body 原样透传给 fetch", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(mockResponse({ data: { id: 1 } }));
    const body = JSON.stringify({ title: "任务", priority: "high" });

    // Act
    await api("/api/v1/tasks", { method: "POST", body });

    // Assert
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(body);
  });

  it("method 透传给 fetch", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(mockResponse({ data: null }));

    // Act
    await api("/api/v1/tasks/1", { method: "DELETE" });

    // Assert
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("DELETE");
  });
});

describe("api 客户端 - 成功响应解包", () => {
  it("返回响应体的 data 字段（信封格式解包）", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(
      mockResponse({ code: 0, data: { id: "t-1", title: "测试任务" } }),
    );

    // Act
    const result = await api<{ id: string; title: string }>("/api/v1/tasks/1");

    // Assert
    expect(result).toEqual({ id: "t-1", title: "测试任务" });
  });

  it("data 为 null 时返回 null", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(mockResponse({ code: 0, data: null }));

    // Act
    const result = await api("/api/v1/some-null-endpoint");

    // Assert
    expect(result).toBeNull();
  });

  it("data 为数组时返回数组", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(
      mockResponse({ code: 0, data: [{ id: "1" }, { id: "2" }] }),
    );

    // Act
    const result = await api<Array<{ id: string }>>("/api/v1/tasks");

    // Assert
    expect(result).toEqual([{ id: "1" }, { id: "2" }]);
  });
});

describe("api 客户端 - 错误响应处理", () => {
  it("非 2xx 响应抛出响应体中的 message", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(
      mockResponse({ code: 400, message: "参数校验失败", data: null }, { status: 400 }),
    );

    // Act & Assert
    await expect(api("/api/v1/tasks")).rejects.toThrow("参数校验失败");
  });

  it("非 2xx 响应无 message 时抛出 fallback 文案（含状态码）", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(
      mockResponse({ code: 500, data: null }, { status: 500, statusText: "Internal Server Error" }),
    );

    // Act & Assert
    await expect(api("/api/v1/tasks")).rejects.toThrow(/请求失败 \(500\)/);
  });

  it("404 响应抛出对应 message", async () => {
    // Arrange
    fetchSpy.mockResolvedValue(
      mockResponse({ code: 404, message: "资源不存在", data: null }, { status: 404 }),
    );

    // Act & Assert
    await expect(api("/api/v1/tasks/missing")).rejects.toThrow("资源不存在");
  });

  it("json 解析失败时使用 statusText 作为 message", async () => {
    // Arrange：构造一个 json() 会抛错的响应
    const brokenResponse = {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response;
    fetchSpy.mockResolvedValue(brokenResponse);

    // Act & Assert
    await expect(api("/api/v1/tasks")).rejects.toThrow("Bad Gateway");
  });
});

describe("api 客户端 - 网络错误处理", () => {
  it("fetch 抛错时 api 透传该错误", async () => {
    // Arrange
    const networkError = new TypeError("Failed to fetch");
    fetchSpy.mockRejectedValue(networkError);

    // Act & Assert
    await expect(api("/api/v1/tasks")).rejects.toThrow("Failed to fetch");
  });

  it("fetch 抛出非 Error 对象时 api 透传", async () => {
    // Arrange
    fetchSpy.mockRejectedValue("string-error");

    // Act & Assert
    await expect(api("/api/v1/tasks")).rejects.toBe("string-error");
  });
});

describe("api 客户端 - 401 自动 refresh 与重试", () => {
  it("401 时自动调 /api/v1/auth/refresh，成功后重试原请求并返回数据", async () => {
    // Arrange
    const unauthorizedResponse = mockResponse(
      { code: 401, message: "token expired", data: null },
      { status: 401 },
    );
    const successResponse = mockResponse({ code: 0, data: { id: "after-refresh" } });
    const refreshResponse = mockResponse({ code: 0, data: null });

    // 第一次原请求返回 401，refresh 成功，第二次原请求成功
    fetchSpy
      .mockResolvedValueOnce(unauthorizedResponse)
      .mockResolvedValueOnce(refreshResponse)
      .mockResolvedValueOnce(successResponse);

    // Act
    const result = await api<{ id: string }>("/api/v1/tasks/1");

    // Assert
    expect(result).toEqual({ id: "after-refresh" });
    // 共 3 次 fetch：原请求 + refresh + 重试
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    // 第 2 次是 refresh
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/v1/auth/refresh");
    const refreshInit = fetchSpy.mock.calls[1][1] as RequestInit;
    expect(refreshInit.method).toBe("POST");
    expect(refreshInit.credentials).toBe("include");
  });

  it("401 时 refresh 失败（非 ok）抛出 unauthorized 错误", async () => {
    // Arrange
    const unauthorizedResponse = mockResponse(
      { code: 401, message: "token expired", data: null },
      { status: 401 },
    );
    const refreshFailResponse = mockResponse(
      { code: 401, message: "refresh failed", data: null },
      { status: 401 },
    );

    fetchSpy
      .mockResolvedValueOnce(unauthorizedResponse)
      .mockResolvedValueOnce(refreshFailResponse);

    // Act & Assert
    await expect(api("/api/v1/tasks/1")).rejects.toThrow("unauthorized");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("401 时 refresh 端点网络错误则抛出 fetch 原始错误", async () => {
    // Arrange
    const unauthorizedResponse = mockResponse(
      { code: 401, message: "token expired", data: null },
      { status: 401 },
    );

    fetchSpy
      .mockResolvedValueOnce(unauthorizedResponse)
      .mockRejectedValueOnce(new TypeError("Network error during refresh"));

    // Act & Assert
    await expect(api("/api/v1/tasks/1")).rejects.toThrow("Network error during refresh");
  });

  it("重试后的请求仍携带原始 headers 与 body", async () => {
    // Arrange
    const unauthorizedResponse = mockResponse(
      { code: 401, data: null },
      { status: 401 },
    );
    const successResponse = mockResponse({ code: 0, data: { ok: true } });
    const refreshResponse = mockResponse({ code: 0, data: null });

    fetchSpy
      .mockResolvedValueOnce(unauthorizedResponse)
      .mockResolvedValueOnce(refreshResponse)
      .mockResolvedValueOnce(successResponse);

    const body = JSON.stringify({ title: "重试任务" });

    // Act
    await api("/api/v1/tasks", { method: "POST", body });

    // Assert：第 3 次（重试）应保留原 method/body/headers
    const retryInit = fetchSpy.mock.calls[2][1] as RequestInit;
    expect(retryInit.method).toBe("POST");
    expect(retryInit.body).toBe(body);
    const retryHeaders = new Headers(retryInit.headers);
    expect(retryHeaders.get("Content-Type")).toBe("application/json");
  });
});
