// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * VirtualList 单元测试
 *
 * 覆盖 web/components/VirtualList.tsx：
 *  - 空列表不崩溃
 *  - 少量项目正常显示所有项
 *  - 大量项目只渲染可见项（虚拟化生效）
 *  - renderItem 回调接收正确的 item 与 index
 *  - className / estimateSize / overscan 透传
 *
 * Mock 策略：@tanstack/react-virtual 的 useVirtualizer 在 jsdom 中无法真实测量
 * 滚动容器（offsetHeight=0），故 mock 为可控函数，返回预设的 virtualizer 对象，
 * 精确控制 getVirtualItems / getTotalSize 以验证虚拟化与渲染逻辑。
 */

const { useVirtualizerMock } = vi.hoisted(() => ({
  useVirtualizerMock: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: useVirtualizerMock,
}));

import { VirtualList } from "@/components/VirtualList";

// ─── 可控 virtualizer 构造工具 ───

interface VirtualItemLike {
  key: number;
  index: number;
  start: number;
}

function makeVirtualItems(count: number, size: number, startIndex = 0): VirtualItemLike[] {
  return Array.from({ length: count }, (_, i) => ({
    key: startIndex + i,
    index: startIndex + i,
    start: (startIndex + i) * size,
  }));
}

function makeVirtualizer(virtualItems: VirtualItemLike[], totalSize: number) {
  return {
    getTotalSize: () => totalSize,
    getVirtualItems: () => virtualItems,
  };
}

beforeEach(() => {
  useVirtualizerMock.mockReset();
});

describe("VirtualList 基础渲染", () => {
  it("渲染空列表不崩溃", () => {
    useVirtualizerMock.mockReturnValue(makeVirtualizer([], 0));
    const { container } = render(
      <VirtualList items={[] as string[]} renderItem={(item) => <div>{item}</div>} />,
    );

    // 外层滚动容器存在
    expect(container.firstChild).toBeInTheDocument();
    // 无列表项渲染
    expect(screen.queryByText("item")).not.toBeInTheDocument();
    // 内层容器总高度为 0
    const inner = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(inner.style.height).toBe("0px");
  });

  it("渲染少量项目正常显示所有项", () => {
    const items = ["A", "B", "C"];
    useVirtualizerMock.mockReturnValue(makeVirtualizer(makeVirtualItems(3, 56), 3 * 56));
    render(<VirtualList items={items} renderItem={(item) => <div>{item}</div>} />);

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("className 透传到外层滚动容器", () => {
    useVirtualizerMock.mockReturnValue(makeVirtualizer([], 0));
    const { container } = render(
      <VirtualList items={[] as string[]} className="custom-scroll" renderItem={() => null} />,
    );

    expect(container.firstChild).toHaveClass("custom-scroll");
  });

  it("外层容器含 overflow:auto 与 contain:strict 样式", () => {
    useVirtualizerMock.mockReturnValue(makeVirtualizer([], 0));
    const { container } = render(
      <VirtualList items={[] as string[]} renderItem={() => null} />,
    );

    const outer = container.firstChild as HTMLElement;
    expect(outer.style.overflow).toBe("auto");
    expect(outer.style.contain).toBe("strict");
  });
});

describe("VirtualList 虚拟化", () => {
  it("渲染大量项目只渲染可见项（虚拟化生效）", () => {
    const items = Array.from({ length: 1000 }, (_, i) => `item-${i}`);
    // 模拟可视区只暴露 5 项（index 0-4），总高度仍为 1000 项
    useVirtualizerMock.mockReturnValue(makeVirtualizer(makeVirtualItems(5, 56), 1000 * 56));
    const { container } = render(
      <VirtualList items={items} renderItem={(item) => <div>{item}</div>} />,
    );

    // 可见项已渲染
    expect(screen.getByText("item-0")).toBeInTheDocument();
    expect(screen.getByText("item-4")).toBeInTheDocument();
    // 不可见项未渲染（虚拟化生效）
    expect(screen.queryByText("item-5")).not.toBeInTheDocument();
    expect(screen.queryByText("item-999")).not.toBeInTheDocument();

    // 内层容器撑起总高度（1000 * 56 = 56000px）
    const inner = (container.firstChild as HTMLElement).firstChild as HTMLElement;
    expect(inner.style.position).toBe("relative");
    expect(inner.style.height).toBe("56000px");
  });

  it("从中间索引开始虚拟化只渲染对应项", () => {
    const items = Array.from({ length: 100 }, (_, i) => `row-${i}`);
    // 模拟滚动到中间，可视区暴露 index 50-54
    useVirtualizerMock.mockReturnValue(makeVirtualizer(makeVirtualItems(5, 56, 50), 100 * 56));
    render(<VirtualList items={items} renderItem={(item) => <div>{item}</div>} />);

    expect(screen.getByText("row-50")).toBeInTheDocument();
    expect(screen.getByText("row-54")).toBeInTheDocument();
    expect(screen.queryByText("row-0")).not.toBeInTheDocument();
    expect(screen.queryByText("row-55")).not.toBeInTheDocument();
  });
});

describe("VirtualList renderItem 回调", () => {
  it("renderItem 接收正确的 item 和 index", () => {
    const items = ["X", "Y"];
    const renderItem = vi.fn((item: string, index: number) => (
      <div data-testid={`item-${index}`}>{item}</div>
    ));
    useVirtualizerMock.mockReturnValue(makeVirtualizer(makeVirtualItems(2, 56), 2 * 56));
    render(<VirtualList items={items} renderItem={renderItem} />);

    expect(renderItem).toHaveBeenCalledTimes(2);
    expect(renderItem).toHaveBeenNthCalledWith(1, "X", 0);
    expect(renderItem).toHaveBeenNthCalledWith(2, "Y", 1);
  });

  it("空列表不调用 renderItem", () => {
    const renderItem = vi.fn(() => <div>x</div>);
    useVirtualizerMock.mockReturnValue(makeVirtualizer([], 0));
    render(<VirtualList items={[] as string[]} renderItem={renderItem} />);

    expect(renderItem).not.toHaveBeenCalled();
  });
});

describe("VirtualList 配置透传", () => {
  it("estimateSize 与 overscan 透传给 useVirtualizer", () => {
    useVirtualizerMock.mockReturnValue(makeVirtualizer([], 0));
    render(
      <VirtualList
        items={[] as string[]}
        estimateSize={80}
        overscan={10}
        renderItem={() => null}
      />,
    );

    expect(useVirtualizerMock).toHaveBeenCalledTimes(1);
    const opts = useVirtualizerMock.mock.calls[0][0] as {
      count: number;
      estimateSize: () => number;
      overscan: number;
    };
    expect(opts.count).toBe(0);
    expect(opts.estimateSize()).toBe(80);
    expect(opts.overscan).toBe(10);
  });

  it("使用默认 estimateSize=56 和 overscan=5", () => {
    useVirtualizerMock.mockReturnValue(makeVirtualizer([], 0));
    render(<VirtualList items={[] as string[]} renderItem={() => null} />);

    const opts = useVirtualizerMock.mock.calls[0][0] as {
      estimateSize: () => number;
      overscan: number;
    };
    expect(opts.estimateSize()).toBe(56);
    expect(opts.overscan).toBe(5);
  });

  it("count 等于 items.length", () => {
    useVirtualizerMock.mockReturnValue(makeVirtualizer([], 0));
    render(<VirtualList items={["a", "b", "c", "d"]} renderItem={() => null} />);

    const opts = useVirtualizerMock.mock.calls[0][0] as { count: number };
    expect(opts.count).toBe(4);
  });
});