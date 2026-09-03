// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * Mermaid 图表渲染单测（v0.4.0 队列第 3 项）
 *
 * 覆盖：
 * 1. Markdown 中 ```mermaid 块分发到 Mermaid 组件（出现 data-mermaid 容器）
 * 2. 渲染成功：mermaid.render 返回 SVG 被注入容器
 * 3. 渲染失败（语法错）：降级为代码块展示原文，不白屏
 * 4. 非 mermaid 代码块不受影响（仍走 <pre><code>）
 *
 * jsdom 下 mock 掉动态 import 的 mermaid 模块（真实库需要 DOM 测量，jsdom 不支持）。
 */

const renderMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => renderMock(...args),
  },
}));

import Markdown from "@/components/Markdown";

const FLOW = `graph TD
  A[讨论] --> B{有结论?}
  B -->|是| C[决策记录]`;

beforeEach(() => {
  renderMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Markdown → Mermaid 分发", () => {
  it("```mermaid 块渲染为 data-mermaid 容器（而非 <pre><code>）", async () => {
    renderMock.mockResolvedValue({ svg: "<svg>graph</svg>" });
    const { container } = render(<Markdown source={"```mermaid\n" + FLOW + "\n```"} />);
    await waitFor(() => {
      expect(container.querySelector("[data-mermaid]")).toBeInTheDocument();
    });
    // 不应出现普通代码块的 pre
    expect(container.querySelector("pre")).not.toBeInTheDocument();
  });

  it("渲染成功时 SVG 被注入容器", async () => {
    renderMock.mockResolvedValue({ svg: '<svg id="diagram"><g/></svg>' });
    const { container } = render(<Markdown source={"```mermaid\n" + FLOW + "\n```"} />);
    await waitFor(() => {
      expect(container.querySelector("[data-mermaid]")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(container.querySelector("[data-mermaid] svg")).toBeInTheDocument();
    });
  });

  it("渲染失败时降级为代码块（原文可见，不白屏）", async () => {
    renderMock.mockRejectedValue(new Error("Parse error"));
    const { container } = render(<Markdown source={"```mermaid\nbroken syntax!!!\n```"} />);
    await waitFor(() => {
      // 降级路径：回退为 <pre><code> 展示原文
      expect(container.querySelector("pre code")).toHaveTextContent("broken syntax!!!");
    });
    expect(container.querySelector("[data-mermaid]")).not.toBeInTheDocument();
  });

  it("非 mermaid 代码块仍走普通 <pre><code> 渲染", () => {
    renderMock.mockResolvedValue({ svg: "<svg/>" });
    const { container } = render(<Markdown source={"```ts\nconst a = 1;\n```"} />);
    expect(container.querySelector("pre code")).toHaveTextContent("const a = 1;");
    expect(container.querySelector("[data-mermaid]")).not.toBeInTheDocument();
    // 非 mermaid 块不应触发 mermaid.render
    expect(renderMock).not.toHaveBeenCalled();
  });

  it("mermaid.initialize 收到 strict 安全级别", async () => {
    const { initialize } = (await vi.importMock("mermaid")).default as never as {
      initialize: ReturnType<typeof vi.fn>;
    };
    renderMock.mockResolvedValue({ svg: "<svg/>" });
    render(<Markdown source={"```mermaid\n" + FLOW + "\n```"} />);
    await waitFor(() => {
      expect(initialize).toHaveBeenCalled();
    });
    const cfg = initialize.mock.calls[0][0] as { securityLevel?: string };
    expect(cfg.securityLevel).toBe("strict");
  });
});

describe("Mermaid 容器占位（加载中状态）", () => {
  it("加载期间容器已挂载（aria-label 为代码前缀）且不闪现代码块", async () => {
    // render 永不 resolve：模拟网络慢
    renderMock.mockReturnValue(new Promise(() => {}));
    const { container } = render(<Markdown source={"```mermaid\n" + FLOW + "\n```"} />);
    expect(container.querySelector("[data-mermaid]")).toBeInTheDocument();
    expect(container.querySelector("pre")).not.toBeInTheDocument();
  });
});

// screen 引用保持（避免未使用导入告警；后续交互类用例使用）
void screen;
