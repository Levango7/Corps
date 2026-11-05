// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

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
vi.mock("@/lib/api", () => ({ api: mocks.api }));

import { DocumentPreview } from "@/components/DocumentPreview";

type PreviewType = "markdown" | "code" | "image" | "text";

function renderPreview(
  type: PreviewType,
  content: string,
  extra: { lang?: string; src?: string; maxHeight?: string } = {},
) {
  const utils = render(
    <DocumentPreview
      document={{ title: "示例文档", content, type, lang: extra.lang, src: extra.src }}
      maxHeight={extra.maxHeight}
    />,
  );
  // 内容区 = section 的第二个子元素（第一个是 header）
  const section = utils.container.querySelector("section")!;
  return { ...utils, contentDiv: section.children[1] as HTMLElement };
}

beforeEach(() => {
  mocks.api.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("DocumentPreview", () => {
  it("markdown：section 带可访问名，头部显示标题与类型徽章，正文渲染 Markdown", () => {
    const { container } = renderPreview("markdown", "# Hello World\n\n**加粗**文字");
    const section = container.querySelector("section")!;
    expect(section).toHaveAttribute("aria-label", "document:previewLabel");
    expect(screen.getByRole("heading", { name: "示例文档" })).toBeInTheDocument();
    expect(screen.getByText("markdown")).toBeInTheDocument();
    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("加粗");
  });

  it("text：pre 原样展示内容，徽章显示 text", () => {
    renderPreview("text", "第一行\n第二行");
    expect(screen.queryByText("markdown")).not.toBeInTheDocument();
    expect(screen.getByText(/第一行/)).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
  });

  it("code：lang 提示优先作为徽章文案，代码内容与行号列均渲染", () => {
    const { container } = renderPreview("code", "print('hi')\nprint('yo')", { lang: "python" });
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.getByText(/print\('hi'\)/)).toBeInTheDocument();
    const lineNumbers = container.querySelector("pre[aria-hidden='true']");
    expect(lineNumbers?.textContent).toBe("1\n2\n");
  });

  it("code：无提示时从 import 关键字推断 ts", () => {
    renderPreview("code", "import { x } from 'y';");
    expect(screen.getByText("ts")).toBeInTheDocument();
  });

  it("code：JSON 内容推断为 json", () => {
    renderPreview("code", '{\n  "a": 1\n}');
    expect(screen.getByText("json")).toBeInTheDocument();
  });

  it("code：DOCTYPE html 内容推断为 html", () => {
    renderPreview("code", "<!DOCTYPE html>\n<html></html>");
    expect(screen.getByText("html")).toBeInTheDocument();
  });

  it("code：XML 声明推断为 xml", () => {
    renderPreview("code", '<?xml version="1.0"?>\n<root/>');
    expect(screen.getByText("xml")).toBeInTheDocument();
  });

  it("code：无法识别的内容回退为 text 徽章", () => {
    renderPreview("code", "just some plain words");
    expect(screen.getByText("text")).toBeInTheDocument();
  });

  it("image：有 src 时渲染 img（alt=标题），徽章显示 image", () => {
    renderPreview("image", "", { src: "https://example.com/a.png" });
    const img = screen.getByRole("img", { name: "示例文档" });
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
    expect(screen.getByText("image")).toBeInTheDocument();
  });

  it("image：缺 src 时显示缺失占位文案", () => {
    renderPreview("image", "");
    expect(screen.getByText("document:previewImageMissing")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("maxHeight 默认 70dvh，传入自定义值时生效", () => {
    const first = renderPreview("text", "内容");
    expect(first.contentDiv.style.maxHeight).toBe("70dvh");
    first.unmount();

    const second = renderPreview("text", "内容", { maxHeight: "40vh" });
    expect(second.contentDiv.style.maxHeight).toBe("40vh");
  });

  it("非 code 类型徽章始终显示类型本身（忽略 lang 提示）", () => {
    renderPreview("markdown", "# 标题", { lang: "md" });
    expect(screen.getByText("markdown")).toBeInTheDocument();
    expect(screen.queryByText("md")).not.toBeInTheDocument();
  });
});
