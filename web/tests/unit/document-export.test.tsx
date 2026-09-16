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
  // F4 重构：导出按钮文案 key 从 exportPdf 改为 export
  "document.export": "导出 PDF",
  "document.exportHint": "将文档导出为 PDF",
  "document.markdownPlaceholder": "markdown",
  "document.autosaveHint": "自动保存",
  "document.saveFailed": "保存失败",
  "document.shareFailed": "分享操作失败",
  "document.loading": "加载中…",
  "document.wordCount": "{count} 字",
  "document.saving": "保存中…",
  // ExportPreview 模态框命名空间
  "exportPreview.print": "打印 / 保存为 PDF",
  "exportPreview.dialogLabel": "导出预览",
  "exportPreview.close": "关闭",
  "exportPreview.previewLabel": "预览",
  "exportPreview.printHint": "在打印对话框中选择「另存为 PDF」",
  "exportPreview.emptyContent": "无内容可导出",
  "exportPreview.batchTitle": "批量导出 ({count}个文档)",
  "exportPreview.printAll": "打印全部",
  "exportPreview.batchPreviewLabel": "批量预览",
  "exportPreview.tableOfContents": "目录",
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
// P1 前端修复后 DocumentEditor 使用 useToast，需 ToastProvider 包裹
import { ToastProvider } from "@/components/Toast";

const INITIAL = {
  title: "测试文档",
  markdown: "# 标题\n\n正文内容",
  publishedMarkdown: null,
  publishedAt: null,
  shareToken: null,
};

/** 包裹 ToastProvider 渲染（P1 修复后 DocumentEditor 依赖 useToast 上下文） */
function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

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
    renderWithToast(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    expect(screen.getByRole("button", { name: "导出 PDF" })).toBeInTheDocument();
  });

  it("点击导出按钮打开模态框，再点击打印按钮调用 window.print()", () => {
    renderWithToast(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    // F4 重构：导出按钮先打开 ExportPreview 模态框
    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    // 模态框内的打印按钮触发 window.print()
    fireEvent.click(screen.getByRole("button", { name: "打印 / 保存为 PDF" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("打印容器（print-area）含标题与 markdown 渲染结果", () => {
    const { container } = renderWithToast(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    const area = container.querySelector(".print-area");
    expect(area).not.toBeNull();
    expect(area).toHaveTextContent("测试文档");
    expect(area).toHaveTextContent("正文内容");
  });

  it("自动保存提示不参与打印输出（print:hidden）", () => {
    renderWithToast(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    const hint = screen.getByText("自动保存");
    // v0.6：提示与字数统计同排容器（flex div 带 print:hidden），断言落在共同父级
    expect(hint.closest(".print\\:hidden")).not.toBeNull();
  });

  it("导出按钮不触发 api 调用（打印纯前端，无需保存）", () => {
    renderWithToast(<DocumentEditor wid="ws-1" id="doc-1" initial={INITIAL} />);
    fireEvent.click(screen.getByRole("button", { name: "导出 PDF" }));
    expect(apiMock).not.toHaveBeenCalled();
  });
});
