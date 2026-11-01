// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * 文本预览契约（components/files/TextPreview.tsx）：
 *  - 三态：loading 占位 / 非 2xx 报错（含重试入口语义的 AlertCircle）/ 正常 <pre>
 *  - 100KB 阈值：超长内容截断并显示 tooLarge 提示条，截断后长度正好 MAX_BYTES
 *  - data-language 取文件名扩展名，无文件名回退 "text"
 *  - AbortError 静默丢弃（不记加载失败）；url 变化时中止旧请求并重新加载
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import { TextPreview } from "@/components/files/TextPreview";

const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TextPreview", () => {
  it("加载中：先渲染 loading 占位", () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = render(<TextPreview url="/f/txt" />);
    expect(container.querySelector('[data-testid="text-preview-loading"]')).toBeTruthy();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("成功：内容进 <pre>，data-language 取扩展名", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok("hello world"));
    const { container } = render(<TextPreview url="/f/a" fileName="notes.MD" />);

    await waitFor(() =>
      expect(container.querySelector('[data-testid="text-preview"]')).toBeTruthy(),
    );
    const pre = container.querySelector("pre")!;
    expect(pre.textContent).toBe("hello world");
    expect(pre.getAttribute("data-language")).toBe("md");
    expect(container.querySelector("svg.lucide-circle-alert")).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "/f/a",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("无文件名：data-language 回退 text", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok("x"));
    const { container } = render(<TextPreview url="/f/b" />);
    await waitFor(() => expect(container.querySelector("pre")).toBeTruthy());
    expect(container.querySelector("pre")!.getAttribute("data-language")).toBe("text");
  });

  it("超过 100KB：截断到 102400 字符并显示 tooLarge 提示", async () => {
    const big = "a".repeat(102400 + 50);
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok(big));
    const { container, getByText } = render(<TextPreview url="/f/big" />);

    await waitFor(() => expect(container.querySelector("pre")).toBeTruthy());
    expect(container.querySelector("pre")!.textContent!.length).toBe(102400);
    expect(getByText("files.preview:tooLarge")).toBeTruthy();
  });

  it("恰好 100KB：不截断、不出提示条", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(ok("b".repeat(102400)));
    const { container } = render(<TextPreview url="/f/edge" />);
    await waitFor(() => expect(container.querySelector("pre")).toBeTruthy());
    expect(container.textContent).not.toContain("files.preview:tooLarge");
    expect(container.querySelector("pre")!.textContent!.length).toBe(102400);
  });

  it("非 2xx：渲染错误态 + AlertCircle", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "",
    });
    const { container, getByText } = render(<TextPreview url="/f/missing" />);

    await waitFor(() =>
      expect(container.querySelector('[data-testid="text-preview-error"]')).toBeTruthy(),
    );
    expect(getByText("files.preview:error")).toBeTruthy();
    expect(container.querySelector("svg.lucide-circle-alert")).toBeTruthy();
  });

  it("AbortError：静默丢弃，不落错误态", async () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    const { container } = render(<TextPreview url="/f/abort" />);

    await waitFor(() =>
      expect(container.querySelector('[data-testid="text-preview"]')).toBeTruthy(),
    );
    expect(container.querySelector('[data-testid="text-preview-error"]')).toBeNull();
    expect(container.querySelector("pre")!.textContent).toBe("");
  });

  it("url 变化：重新请求并展示新内容", async () => {
    const mock = fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(ok("first")).mockResolvedValueOnce(ok("second"));
    const { container, rerender } = render(<TextPreview url="/f/1" />);
    await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe("first"));

    rerender(<TextPreview url="/f/2" />);
    await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe("second"));
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[1][0]).toBe("/f/2");
  });
});
