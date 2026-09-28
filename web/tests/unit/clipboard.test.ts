// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyText } from "@/lib/clipboard";

/**
 * copyText 降级链单元测试
 *
 * 覆盖 web/lib/clipboard.ts 的三条路径：
 *  1. 安全上下文 → 异步 Clipboard API
 *  2. HTTP 非安全上下文（navigator.clipboard 为 undefined，自托管局域网常见）→ execCommand 降级
 *  3. 两条路都不通 → 抛错，由调用方提示失败（绝不静默"点了没反应"）
 *
 * jsdom 未实现 document.execCommand，测试里按需桩掉。
 */

function stubClipboard(impl: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: impl,
    configurable: true,
    writable: true,
  });
}

let execCommandMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  execCommandMock = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", {
    value: execCommandMock,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("优先使用异步 Clipboard API，不走降级", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });

    await copyText("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommandMock).not.toHaveBeenCalled();
  });

  it("无 Clipboard API（HTTP 非安全上下文）时降级到 execCommand", async () => {
    stubClipboard(undefined);

    await copyText("fallback");

    expect(execCommandMock).toHaveBeenCalledWith("copy");
  });

  it("Clipboard API 被拒时仍尝试降级并成功", async () => {
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });

    await copyText("retry");

    expect(execCommandMock).toHaveBeenCalledWith("copy");
  });

  it("两条路都不可用才抛错", async () => {
    stubClipboard(undefined);
    execCommandMock.mockReturnValue(false);

    await expect(copyText("nope")).rejects.toThrow("clipboard unavailable");
  });

  it("降级用的一次性节点会清理干净，不残留 DOM", async () => {
    stubClipboard(undefined);
    const before = document.querySelectorAll("textarea").length;

    await copyText("cleanup");

    expect(document.querySelectorAll("textarea").length).toBe(before);
  });
});
