// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AttachmentPreviewModal 契约（components/AttachmentPreviewModal.tsx，named 导出）：
 *  1. attachment=null → 不渲染
 *  2. dialog 角色 + aria-modal + aria-label=previewAria{name}
 *  3. 头部：文件名 + 下载链接（href=url、download=文件名）+ 关闭按钮
 *  4. image/* → <img src alt>；application/pdf → <iframe src title>；
 *     其余类型 → noInlinePreview 文案 + 带文字的下载按钮
 *  5. Esc / 遮罩点击关闭；内层点击不关（stopPropagation）
 *  6. body 滚动锁：打开时 overflow=hidden，卸载恢复
 *  7. 焦点管理：打开后聚焦关闭按钮
 */

const mocks = vi.hoisted(() => ({ onClose: vi.fn() }));

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});

import { AttachmentPreviewModal } from "@/components/AttachmentPreviewModal";

const FILE = { url: "/files/report.pdf", fileName: "季度报告.pdf", fileType: "application/pdf" };

function renderModal(
  attachment: { url: string; fileName: string; fileType: string } | null = FILE,
) {
  return render(<AttachmentPreviewModal attachment={attachment} onClose={mocks.onClose} />);
}

beforeEach(() => {
  mocks.onClose.mockReset();
  // rAF 立即执行：焦点管理断言确定性
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttachmentPreviewModal", () => {
  it("attachment=null → 不渲染", () => {
    const { container } = renderModal(null);
    expect(container.firstChild).toBeNull();
  });

  it("dialog 角色 + aria-modal + aria-label 带文件名", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", 'attachment:previewAria:{"name":"季度报告.pdf"}');
  });

  it("头部：文件名 + 下载链接（href/download）+ 关闭按钮", () => {
    renderModal();
    expect(screen.getByText("季度报告.pdf")).toBeInTheDocument();
    const dl = screen.getAllByLabelText("attachment:download");
    expect(dl[0].getAttribute("href")).toBe("/files/report.pdf");
    expect(dl[0].getAttribute("download")).toBe("季度报告.pdf");
    expect(screen.getByLabelText("attachment:close")).toBeInTheDocument();
  });

  it("image/* → img（src/alt），无 iframe、无 noInlinePreview", () => {
    const { container } = renderModal({
      url: "/files/pic.png",
      fileName: "截图.png",
      fileType: "image/png",
    });
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img).toHaveAttribute("src", "/files/pic.png");
    expect(img).toHaveAttribute("alt", "截图.png");
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByText("attachment:noInlinePreview")).toBeFalsy();
  });

  it("application/pdf → iframe（src/title）", () => {
    const { container } = renderModal();
    const iframe = container.querySelector("iframe");
    expect(iframe).toBeTruthy();
    expect(iframe).toHaveAttribute("src", "/files/report.pdf");
    expect(iframe).toHaveAttribute("title", "季度报告.pdf");
    expect(container.querySelector("img")).toBeNull();
  });

  it("其他类型 → noInlinePreview 文案 + 带文字的下载链接（头/内各一个下载入口）", () => {
    const { container } = renderModal({
      url: "/files/a.zip",
      fileName: "打包.zip",
      fileType: "application/zip",
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("attachment:noInlinePreview")).toBeInTheDocument();
    // 头部下载 aria-label 显式声明；内容区下载按钮无 aria-label，name 来自文字
    const dls = screen.getAllByRole("link", { name: "attachment:download" });
    expect(dls).toHaveLength(2);
    expect(screen.getByText("attachment:download")).toBeInTheDocument();
    dls.forEach((a) => expect(a.getAttribute("href")).toBe("/files/a.zip"));
  });

  it("关闭按钮 → onClose", () => {
    renderModal();
    fireEvent.click(screen.getByLabelText("attachment:close"));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc 关闭", () => {
    renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("遮罩（dialog 自身）点击关闭；内层内容点击不关", () => {
    renderModal();
    fireEvent.click(screen.getByText("季度报告.pdf"));
    expect(mocks.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog"));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("body 滚动锁：打开 hidden、卸载恢复", () => {
    const { unmount } = renderModal();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("打开后焦点移到关闭按钮", async () => {
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("attachment:close")).toHaveFocus());
  });
});
