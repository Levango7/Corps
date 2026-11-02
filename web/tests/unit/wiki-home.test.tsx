// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { WikiHome } from "@/components/wiki/WikiHome";

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

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

vi.mock("@/components/wiki/WikiSidebar", () => ({
  WikiSidebar: (props: {
    wid: string;
    onSelect: (page: { id: string }) => void;
    refreshKey?: number;
  }) => (
    <div data-testid="wiki-sidebar" data-wid={props.wid} data-refresh={props.refreshKey ?? 0}>
      <button type="button" onClick={() => props.onSelect({ id: "p-1" })}>
        side-select
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  pushMock.mockReset();
  vi.restoreAllMocks();
});

/** 抽屉打开时会出现遮罩与抽屉容器（class 含 fixed）；关闭时不存在 */
const fixedDivs = (container: HTMLElement) => container.querySelectorAll('div[class~="fixed"]');

describe("WikiHome 欢迎页", () => {
  it("渲染标题与选择提示", () => {
    render(<WikiHome wid="ws-1" />);
    expect(screen.getByRole("heading", { name: "wiki:title" })).toBeInTheDocument();
    expect(screen.getByText("wiki:selectPage")).toBeInTheDocument();
  });

  it("含展开侧边栏的汉堡按钮（aria-label=title）", () => {
    render(<WikiHome wid="ws-1" />);
    expect(screen.getByRole("button", { name: "wiki:title" })).toBeInTheDocument();
  });

  it("向 WikiSidebar 传递 wid 与 refreshKey", () => {
    render(<WikiHome wid="ws-1" />);
    const sidebar = screen.getByTestId("wiki-sidebar");
    expect(sidebar).toHaveAttribute("data-wid", "ws-1");
    expect(sidebar).toHaveAttribute("data-refresh", "0");
  });
});

describe("WikiHome 移动端抽屉", () => {
  it("初始抽屉关闭：无遮罩无抽屉容器", () => {
    const { container } = render(<WikiHome wid="ws-1" />);
    expect(fixedDivs(container)).toHaveLength(0);
  });

  it("点击汉堡按钮打开抽屉并出现遮罩", () => {
    const { container } = render(<WikiHome wid="ws-1" />);
    fireEvent.click(screen.getByRole("button", { name: "wiki:title" }));
    expect(fixedDivs(container)).toHaveLength(2);
  });

  it("点击遮罩关闭抽屉", () => {
    const { container } = render(<WikiHome wid="ws-1" />);
    fireEvent.click(screen.getByRole("button", { name: "wiki:title" }));
    fireEvent.click(container.querySelector('div[class~="fixed"]')!);
    expect(fixedDivs(container)).toHaveLength(0);
  });

  it("点击抽屉内关闭按钮关闭抽屉", () => {
    const { container } = render(<WikiHome wid="ws-1" />);
    fireEvent.click(screen.getByRole("button", { name: "wiki:title" }));
    fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }));
    expect(fixedDivs(container)).toHaveLength(0);
  });

  it("抽屉打开时点击侧边栏选项后跳转并自动关闭抽屉", async () => {
    const { container } = render(<WikiHome wid="ws-1" />);
    fireEvent.click(screen.getByRole("button", { name: "wiki:title" }));
    fireEvent.click(screen.getByText("side-select"));
    await act(async () => {});
    expect(pushMock).toHaveBeenCalledWith("/w/ws-1/wiki/p-1");
    expect(fixedDivs(container)).toHaveLength(0);
  });

  it("桌面端（抽屉未开）侧边栏选项也能跳转", async () => {
    render(<WikiHome wid="ws-1" />);
    fireEvent.click(screen.getByText("side-select"));
    await act(async () => {});
    expect(pushMock).toHaveBeenCalledWith("/w/ws-1/wiki/p-1");
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});
