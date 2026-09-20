import { describe, it, expect, vi } from "vitest";
import {
  API_MESSAGES,
  apiLocale,
  apiMsg,
  type ApiMsgKey,
} from "@/lib/api-messages";

// Mock NextRequest
function mockReq(opts: {
  cookie?: string;
  acceptLanguage?: string;
}): import("next/server").NextRequest {
  const headers = new Headers();
  if (opts.acceptLanguage) {
    headers.set("accept-language", opts.acceptLanguage);
  }
  const cookies: { name: string; value: string }[] = [];
  if (opts.cookie) {
    cookies.push({ name: "NEXT_LOCALE", value: opts.cookie });
  }
  return {
    cookies: {
      get: (name: string) => cookies.find((c) => c.name === name),
    },
    headers,
  } as unknown as import("next/server").NextRequest;
}

describe("api-messages - 双语常量完整性", () => {
  it("每个 key 都有 zh 和 en 两个语言", () => {
    for (const key of Object.keys(API_MESSAGES) as ApiMsgKey[]) {
      const entry = API_MESSAGES[key];
      expect(entry).toHaveProperty("zh");
      expect(entry).toHaveProperty("en");
      expect(typeof entry.zh).toBe("string");
      expect(typeof entry.en).toBe("string");
      expect(entry.zh.length).toBeGreaterThan(0);
      expect(entry.en.length).toBeGreaterThan(0);
    }
  });

  it("zh 和 en 文案不完全相同（排除合理例外）", () => {
    // 部分合理例外：缩写或专有名词
    const EXEMPT = new Set(["ok"]);
    for (const key of Object.keys(API_MESSAGES) as ApiMsgKey[]) {
      if (EXEMPT.has(key)) continue;
      const entry = API_MESSAGES[key];
      expect(entry.zh).not.toBe(entry.en);
    }
  });
});

describe("apiLocale - 语言协商", () => {
  it("NEXT_LOCALE cookie = zh → 返回 zh", () => {
    const req = mockReq({ cookie: "zh" });
    expect(apiLocale(req)).toBe("zh");
  });

  it("NEXT_LOCALE cookie = en → 返回 en", () => {
    const req = mockReq({ cookie: "en" });
    expect(apiLocale(req)).toBe("en");
  });

  it("无 cookie + Accept-Language 含 zh → 返回 zh", () => {
    const req = mockReq({ acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8" });
    expect(apiLocale(req)).toBe("zh");
  });

  it("无 cookie + Accept-Language 含 en → 返回 en", () => {
    const req = mockReq({ acceptLanguage: "en-US,en;q=0.9" });
    expect(apiLocale(req)).toBe("en");
  });

  it("无 cookie + 无 Accept-Language → 回退 zh", () => {
    const req = mockReq({});
    expect(apiLocale(req)).toBe("zh");
  });

  it("无 cookie + Accept-Language 不含 zh/en → 回退 zh", () => {
    const req = mockReq({ acceptLanguage: "fr-FR,fr;q=0.9" });
    expect(apiLocale(req)).toBe("zh");
  });

  it("cookie 优先于 Accept-Language", () => {
    const req = mockReq({ cookie: "en", acceptLanguage: "zh-CN" });
    expect(apiLocale(req)).toBe("en");
  });
});

describe("apiMsg - 取文案", () => {
  it("zh locale 返回中文文案", () => {
    const req = mockReq({ cookie: "zh" });
    expect(apiMsg(req, "taskNotFound")).toBe("任务不存在");
  });

  it("en locale 返回英文文案", () => {
    const req = mockReq({ cookie: "en" });
    expect(apiMsg(req, "taskNotFound")).toBe("Task not found");
  });

  it("默认 locale（zh）返回中文文案", () => {
    const req = mockReq({});
    expect(apiMsg(req, "unauthorized")).toBe("未授权");
  });
});