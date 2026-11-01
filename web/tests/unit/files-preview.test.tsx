// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * 预览统一入口契约（components/files/FilePreview.tsx）：
 *  - getFileCategory：扩展名 → 七分类（pdf/office/image/video/audio/text/other），
 *    无扩展名与未知扩展名都落 other，大小写不敏感
 *  - 分发：pdf→iframe / office→Office Online Viewer（url 需 encode）/ image→img /
 *    video→<video controls> / audio→<audio controls> / text→TextPreview / other→下载兜底
 *  - 舞台：dialog 语义 + 标题栏（文件名、下载链接 download 属性、关闭按钮）
 *  - Esc 关闭；挂载时锁 body 滚动，卸载时恢复原值
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

vi.mock("@/components/files/TextPreview", async () => {
  const React = await import("react");
  return {
    TextPreview: ({ url, fileName }: { url: string; fileName?: string }) =>
      React.createElement("div", {
        "data-testid": "text-stub",
        "data-url": url,
        "data-name": fileName,
      }),
  };
});

import { FilePreview, getFileCategory } from "@/components/files/FilePreview";

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.style.overflow = "visible";
});

describe("getFileCategory", () => {
  it("七分类各自命中，大小写不敏感", () => {
    expect(getFileCategory("a.pdf")).toBe("pdf");
    expect(getFileCategory("a.DOCX")).toBe("office");
    expect(getFileCategory("a.JPEG")).toBe("image");
    expect(getFileCategory("a.mp4")).toBe("video");
    expect(getFileCategory("a.flac")).toBe("audio");
    expect(getFileCategory("a.YML")).toBe("text");
    expect(getFileCategory("a.bin")).toBe("other");
  });

  it("无扩展名：落 other 不抛错", () => {
    expect(getFileCategory("README")).toBe("other");
    expect(getFileCategory("")).toBe("other");
  });
});

describe("FilePreview 分发", () => {
  const mount = (fileName: string, url = "/f/x") =>
    render(<FilePreview url={url} fileName={fileName} fileType="" onClose={vi.fn()} />);

  it("pdf → iframe", () => {
    const { container } = mount("a.pdf");
    expect(container.querySelector('[data-testid="pdf-preview"]')).toBeTruthy();
  });

  it("office → Office Online Viewer，url 编码进查询串", () => {
    const { container } = mount("a.xlsx", "/f/a b.xlsx");
    const iframe = container.querySelector('[data-testid="office-preview"]');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("src")).toContain("view.officeapps.live.com/view.aspx?url=");
    expect(iframe?.getAttribute("src")).toContain(encodeURIComponent("/f/a b.xlsx"));
  });

  it("image → img（alt 为文件名、禁拖拽）", () => {
    const { container } = mount("a.png");
    const img = container.querySelector('[data-testid="image-preview"] img');
    expect(img?.getAttribute("src")).toBe("/f/x");
    expect(img?.getAttribute("alt")).toBe("a.png");
    expect(img?.getAttribute("draggable")).toBe("false");
  });

  it("video → <video controls>", () => {
    const { container } = mount("a.webm");
    const video = container.querySelector('[data-testid="video-preview"] video');
    expect(video?.getAttribute("src")).toBe("/f/x");
    expect(video?.hasAttribute("controls")).toBe(true);
  });

  it("audio → <audio controls>", () => {
    const { container } = mount("a.mp3");
    const audio = container.querySelector('[data-testid="audio-preview"] audio');
    expect(audio?.getAttribute("src")).toBe("/f/x");
    expect(audio?.hasAttribute("controls")).toBe(true);
  });

  it("text → TextPreview（透传 url 与文件名）", () => {
    const { container } = mount("a.ts");
    const stub = container.querySelector('[data-testid="text-stub"]');
    expect(stub?.getAttribute("data-url")).toBe("/f/x");
    expect(stub?.getAttribute("data-name")).toBe("a.ts");
  });

  it("other → 不支持提示 + 下载兜底链接", () => {
    const { container, getByText } = mount("a.bin");
    expect(getByText("files.preview:unsupported")).toBeTruthy();
    expect(container.querySelector("svg.lucide-file-warning")).toBeTruthy();
    const link = container.querySelector("a[download]");
    expect(link?.getAttribute("href")).toBe("/f/x");
    expect(link?.getAttribute("download")).toBe("a.bin");
  });
});

describe("FilePreview 舞台", () => {
  it("dialog 语义 + 标题栏下载链接与关闭按钮", () => {
    const onClose = vi.fn();
    const { getByRole, container } = render(
      <FilePreview url="/f/x" fileName="a.pdf" fileType="pdf" onClose={onClose} />,
    );
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe('files.preview:previewAria:{"name":"a.pdf"}');
    expect(container.querySelector("header")?.textContent).toContain("a.pdf");

    fireEvent.click(getByRole("button"));
    expect(onClose).toHaveBeenCalledTimes(1);

    const dl = container.querySelector("header a")!;
    expect(dl.getAttribute("download")).toBe("a.pdf");
    expect(dl.textContent).toContain("files.preview:download");
  });

  it("Esc 关闭；卸载后移除监听", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <FilePreview url="/f/x" fileName="a.pdf" fileType="pdf" onClose={onClose} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("挂载锁滚动，卸载恢复原值", () => {
    document.body.style.overflow = "scroll";
    const { unmount } = render(
      <FilePreview url="/f/x" fileName="a.pdf" fileType="pdf" onClose={vi.fn()} />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("scroll");
  });
});
