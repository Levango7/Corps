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

import { PublicDocumentView } from "@/components/PublicDocumentView";

function renderView(overrides: Partial<Parameters<typeof PublicDocumentView>[0]> = {}) {
  return render(
    <PublicDocumentView
      title="公开文档标题"
      markdown={"# 正文标题\n\n**加粗**内容"}
      workspace={{ name: "设计部", slug: "design" }}
      author={{ name: "李四" }}
      publishedAt="2026-05-01T08:00:00Z"
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mocks.api.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("PublicDocumentView", () => {
  it("渲染 h1 标题与 Markdown 正文（标题/加粗）", () => {
    const { container } = renderView();
    expect(screen.getByRole("heading", { level: 1, name: "公开文档标题" })).toBeInTheDocument();
    expect(screen.getByText("正文标题")).toBeInTheDocument();
    expect(container.querySelector(".prose strong")?.textContent).toBe("加粗");
  });

  it("渲染工作区名、作者名与页脚提示（product 变量注入）", () => {
    const { container } = renderView();
    expect(screen.getByText(/document:workspaceLabel/)).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("设计部"); // 第一个 strong = workspace
    expect(screen.getByText("李四")).toBeInTheDocument();
    expect(screen.getByText('document:footerHint:{"product":"corps"}')).toBeInTheDocument();
  });

  it("workspace 为 null 时不渲染工作区标签", () => {
    renderView({ workspace: null });
    expect(screen.queryByText(/document:workspaceLabel/)).not.toBeInTheDocument();
    expect(screen.getByText(/document:authorLabel/)).toBeInTheDocument();
  });

  it("author 为 null 且未脱敏时显示 unknownAuthor", () => {
    renderView({ author: null, redacted: false });
    expect(screen.getByText("document:unknownAuthor")).toBeInTheDocument();
  });

  it("author 为 null 且脱敏时显示 anonymous", () => {
    renderView({ author: null, redacted: true });
    expect(screen.getByText("document:anonymous")).toBeInTheDocument();
    expect(screen.queryByText("document:unknownAuthor")).not.toBeInTheDocument();
  });

  it("author.name 为 null 时同样按脱敏/未脱敏兜底", () => {
    const first = renderView({ author: { name: null }, redacted: true });
    expect(screen.getByText("document:anonymous")).toBeInTheDocument();
    first.unmount();
    renderView({ author: { name: null }, redacted: false });
    expect(screen.getByText("document:unknownAuthor")).toBeInTheDocument();
  });

  it("publishedAt 有值时渲染发布时间前缀（date 为本地化字符串）", () => {
    renderView();
    expect(screen.getByText(/^document:publishedAt:/)).toBeInTheDocument();
  });

  it("publishedAt 为 null 时不渲染发布时间", () => {
    renderView({ publishedAt: null });
    expect(screen.queryByText(/^document:publishedAt:/)).not.toBeInTheDocument();
  });

  it("有名字的作者直接显示在作者位（即使 redacted=true）", () => {
    const { container } = renderView({ redacted: true });
    expect(screen.getByText("李四")).toBeInTheDocument();
    expect(screen.queryByText("document:anonymous")).not.toBeInTheDocument();
    const strongs = Array.from(container.querySelectorAll("strong"));
    expect(strongs.map((s) => s.textContent)).toContain("李四");
  });

  it("redacted 默认 false", () => {
    renderView({ author: null });
    expect(screen.getByText("document:unknownAuthor")).toBeInTheDocument();
  });

  it("正文支持链接语法（Markdown 白名单内站内路径）", () => {
    renderView({ markdown: "[首页](/home)" });
    const link = screen.getByRole("link", { name: "首页" });
    expect(link).toHaveAttribute("href", "/home");
  });
});
