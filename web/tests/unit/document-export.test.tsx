// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * DocumentEditor 导出 PDF 单测（v0.4.0 队列第 4 项）
 *
 * 覆盖：
 * 1. 工具栏渲染「导出 PDF」按钮
 * 2. 点击导出按钮调用 window.print()（打印 CSS + 浏览器另存为 PDF 方案）
 * 3. 打印容器（print-area）含标题与 markdown 渲染结果
 * 4. 自动保存提示在打印容器上带 print:hidden（不参与打印输出）
 */

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const zhFlat: Record<string, string> = {
  "document.titlePlaceholder": "文档标题",
  "document.publishedAt": "发布于 {date}",
  "document.backToList": "返回列表",
  "document.editMode": "编辑",
  "document.previewMode": "预览",
  "document.publish": "发布",
  "document.share": "生成分享链接",
  "document.unshare": "取消分享",
  "document.shareUrl": "分享链接",
  "document.copy": "复制",
  "document.exportPdf": "导出 PDF",
  "document.exportPdfHint": "将文档导出为 PDF",
  "document.markdownPlaceholder": "markdown",
  "document.autosaveHint": "自动保存",
  "document.saveFailed": "保存失败",
  "document.shareFailed": "分享操作失败",
  "document.loading": "加载中…",
};

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, unknown>) => {
    let out = zhFlat[`${ns}.${key}`] ?? key;
    if (values) {
      for (const [k, v] of Object.entries(values)) {
        out = out.replace(`{${k}}`, String(v));
      }
    }
    return out;
  },
}));

import { DocumentEditor } from "@/components/DocumentEditor";

const INITIAL = {
  title: "测试文档",
  markdown: "# 标题\n\n正文内容",
  publishedMarkdown: null,
  publishedAt: null,
  shareToken: null,
};

describe("DocumentEditor - 导出 PDF", () => {
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({ id: "doc-1", publishedAt: null, shareToken: null });
    printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("工具栏渲染「导出 PDF」按钮", () => {
    render(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    expect(screen.getByRole("button", { name: "导出 PDF" })).toBeInTheDocument();
  });

  it("点击导出按钮调用 window.print()", () => {
    render(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("打印容器（print-area）含标题与 markdown 渲染结果", () => {
    const { container } = render(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    const area = container.querySelector(".print-area");
    expect(area).not.toBeNull();
    expect(area).toHaveTextContent("测试文档");
    expect(area).toHaveTextContent("正文内容");
  });

  it("自动保存提示不参与打印输出（print:hidden）", () => {
    render(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    const hint = screen.getByText("自动保存");
    expect(hint.className).toContain("print:hidden");
  });

  it("导出按钮不触发 api 调用（打印纯前端，无需保存）", () => {
    render(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    expect(apiMock).not.toHaveBeenCalled();
  });
});
