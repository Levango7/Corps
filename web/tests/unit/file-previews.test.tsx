// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

import { AudioPreview } from "@/components/files/previews/AudioPreview";
import { VideoPreview } from "@/components/files/previews/VideoPreview";
import { MarkdownPreview } from "@/components/files/previews/MarkdownPreview";
import { PdfPreview } from "@/components/files/previews/PdfPreview";
import { OfficePreview } from "@/components/files/previews/OfficePreview";
import { CodePreview } from "@/components/files/previews/CodePreview";
import { ImagePreview } from "@/components/files/previews/ImagePreview";
import { VideoPreview as LegacyVideoPreview } from "@/components/files/VideoPreview";
import { PdfPreview as LegacyPdfPreview } from "@/components/files/PdfPreview";

/**
 * 文件预览组件族契约（components/files/previews/* 与 files/VideoPreview.tsx）：
 *  - 各自渲染对应原生媒体元素（audio/video/iframe）且带 controls（iframe 走浏览器 PDF 渲染）
 *  - 容器带 data-testid（集成方据此定位）；视频/音频容器走 surface-2 底色
 *  - PdfPreview 是 async server component：title 走 files.pdfPreview.title 文案
 *  - MarkdownPreview：内容经共享 Markdown 渲染器（本测试 mock 它，只验容器与透传）
 *  - 两处 VideoPreview（previews/ 与 files/ 根）行为一致：容器 + video/controls
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

vi.mock("@/components/Markdown", () => ({
  default: ({ source }: { source: string }) => <div data-testid="md-render">{source}</div>,
}));

const renderAsync = async (el: ReactElement): Promise<RenderResult> => render(el);

describe("AudioPreview", () => {
  it("音频容器 + Music 图标 + audio[controls] 指向 src", () => {
    const { container } = render(<AudioPreview src="https://x/a.mp3" />);
    expect(container.querySelector('[data-testid="audio-preview"]')).toBeTruthy();
    expect(container.querySelector("svg.lucide-music")).toBeTruthy();
    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("https://x/a.mp3");
    expect(audio.hasAttribute("controls")).toBe(true);
  });
});

describe("VideoPreview（previews 与 files 根两处）", () => {
  it("previews/VideoPreview：容器 + video[controls]", () => {
    const { container } = render(<VideoPreview src="https://x/v.mp4" />);
    expect(container.querySelector('[data-testid="video-preview"]')).toBeTruthy();
    const video = container.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("https://x/v.mp4");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(container.firstElementChild!.className).toContain("bg-[var(--surface-2)]");
  });

  it("files/VideoPreview（旧位置）：行为一致（url prop）", () => {
    const { container } = render(<LegacyVideoPreview url="https://x/w.webm" />);
    expect(container.querySelector('[data-testid="video-preview"]')).toBeTruthy();
    expect(container.querySelector("video")!.getAttribute("src")).toBe("https://x/w.webm");
  });
});

describe("MarkdownPreview", () => {
  it("容器 + 内容经共享 Markdown 渲染器（source 透传）", () => {
    const { container, getByTestId } = render(<MarkdownPreview content="# 标题" />);
    expect(container.querySelector('[data-testid="markdown-preview"]')).toBeTruthy();
    expect(getByTestId("md-render").textContent).toBe("# 标题");
    // 限宽阅读区 var(--prose-max)
    expect(container.querySelector(".max-w-\\[var\\(--prose-max\\)\\]")).toBeTruthy();
  });
});

describe("PdfPreview（async server component）", () => {
  it("直接 await 渲染：iframe[title=files.pdfPreview:title]、data-testid、无边框", async () => {
    const el = await PdfPreview({ src: "https://x/doc.pdf" });
    const { container } = await renderAsync(el);
    const iframe = container.querySelector('iframe[data-testid="pdf-preview"]')!;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute("src")).toBe("https://x/doc.pdf");
    expect(iframe.getAttribute("title")).toBe("files.pdfPreview:title");
    expect(iframe.className).toContain("border-0");
  });
});

describe("files/PdfPreview（旧位置，client 版）", () => {
  it("iframe 的 title 走 files.preview 命名空间", () => {
    const { container } = render(<LegacyPdfPreview url="https://x/old.pdf" />);
    const iframe = container.querySelector('iframe[data-testid="pdf-preview"]')!;
    expect(iframe.getAttribute("src")).toBe("https://x/old.pdf");
    expect(iframe.getAttribute("title")).toBe("files.preview:title");
  });
});

describe("OfficePreview（降级方案）", () => {
  it("提示文案带扩展名标签（去点大写）+ 下载链接（href/download/Download 图标）", async () => {
    const el = await OfficePreview({ src: "https://x/a.docx", fileType: ".docx" });
    const { container } = await renderAsync(el);
    expect(container.querySelector('[data-testid="office-preview"]')).toBeTruthy();
    expect(container.textContent).toContain("DOCX");
    expect(container.textContent).toContain("files.officePreview:downloadFile");
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://x/a.docx");
    expect(link.hasAttribute("download")).toBe(true);
    expect(container.querySelector("svg.lucide-download")).toBeTruthy();
  });
});

describe("CodePreview", () => {
  it("行号 aria-hidden + code 行逐行渲染 + data-language 取自 language/扩展名", async () => {
    const el = await CodePreview({
      content: "line1\nline2\n",
      fileName: "a.ts",
      language: "typescript",
    });
    const { container } = await renderAsync(el);
    const root = container.querySelector('[data-testid="code-preview"]')!;
    expect(root.getAttribute("data-language")).toBe("typescript");
    expect(root.getAttribute("aria-label")).toBe('files.codePreview:ariaLabel:{"name":"a.ts"}');
    const lines = container.querySelectorAll("code");
    expect(Array.from(lines).map((l) => l.textContent)).toEqual(["line1", "line2", ""]);
    const nums = container.querySelectorAll('span[aria-hidden="true"]');
    expect(Array.from(nums).map((n) => n.textContent)).toEqual(["1", "2", "3"]);
  });

  it("未传 language：取文件名扩展名", async () => {
    const el = await CodePreview({ content: "x", fileName: "b.py" });
    const { container } = await renderAsync(el);
    expect(
      container.querySelector('[data-testid="code-preview"]')!.getAttribute("data-language"),
    ).toBe("py");
  });
});

describe("ImagePreview", () => {
  it("初始显示加载提示；onLoad 后消失；alt=文件名", () => {
    const { container, getByText } = render(
      <ImagePreview src="https://x/i.png" fileName="i.png" />,
    );
    expect(getByText("files.imagePreview:loading")).toBeTruthy();
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://x/i.png");
    expect(img.getAttribute("alt")).toBe("i.png");
    fireEvent.load(img);
    expect(container.textContent).not.toContain("files.imagePreview:loading");
  });

  it("滚轮缩放：上滚放大 0.1、下滚缩小 0.1，钳制在 0.2~5", () => {
    const { container } = render(<ImagePreview src="https://x/i.png" fileName="i.png" />);
    const root = container.querySelector('[data-testid="image-preview"]')!;
    const img = container.querySelector("img")!;
    fireEvent.wheel(root, { deltaY: -1 }); // 放大
    expect(img.style.transform).toBe("scale(1.1)");
    fireEvent.wheel(root, { deltaY: 1 }); // 缩小
    expect(img.style.transform).toBe("scale(1)");
    for (let i = 0; i < 60; i++) fireEvent.wheel(root, { deltaY: -1 }); // 连续放大到上限
    expect(img.style.transform).toBe("scale(5)");
    for (let i = 0; i < 80; i++) fireEvent.wheel(root, { deltaY: 1 }); // 连续缩小到下限
    expect(img.style.transform).toBe("scale(0.2)");
  });
});
