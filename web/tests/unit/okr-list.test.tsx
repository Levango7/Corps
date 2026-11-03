// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: class ApiError extends Error {} }));

import { OKRList } from "@/components/okr/OKRList";

const BASE = "/api/v1/workspaces/ws-1/objectives";

const items = [
  {
    id: "o-1",
    title: "Grow ARR",
    description: "top line",
    ownerId: "u-1",
    period: "2026-Q1",
    status: "active",
    progress: 42.5,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    owner: { id: "u-1", name: "Alice", email: "alice@example.com" },
    _count: { keyResults: 3 },
  },
  {
    id: "o-2",
    title: "Cut churn",
    description: null,
    ownerId: null,
    period: "2026-Q2",
    status: "draft",
    progress: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    owner: null,
    _count: { keyResults: 0 },
  },
];

function urls() {
  return mocks.api.mock.calls.map((c) => c[0] as string).filter((p) => p.startsWith(BASE));
}

function defaultApi(list: unknown[] = items) {
  mocks.api.mockImplementation(async () => ({ items: list }));
}

function renderList(overrides: Partial<Parameters<typeof OKRList>[0]> = {}) {
  const props = {
    wid: "ws-1",
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  };
  const utils = render(<OKRList {...props} />);
  return { ...utils, ...props };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OKRList", () => {
  it("加载中只渲染转圈；首拉不带过滤参数", () => {
    defaultApi();
    const { container } = renderList();
    expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();
    expect(screen.queryByText("okr:noObjectives")).not.toBeInTheDocument();
    expect(urls()[0]).toBe(`${BASE}?`);
  });

  it("列表渲染标题/周期/进度百分比/关键结果数", async () => {
    defaultApi();
    const { container } = renderList();
    await waitFor(() => expect(screen.getByText("Grow ARR")).toBeInTheDocument());

    expect(screen.getByText("2026-Q1")).toBeInTheDocument();
    expect(screen.getByText("Cut churn")).toBeInTheDocument();
    // 进度取整
    expect(screen.getByText("43%")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("okr:keyResults · 3")).toBeInTheDocument();
    expect(screen.getByText("okr:keyResults · 0")).toBeInTheDocument();

    // 进度条宽度按取整后的百分比
    const bars = Array.from(container.querySelectorAll("li div[style]")) as HTMLElement[];
    expect(bars[0].style.width).toBe("43%");
    expect(bars[1].style.width).toBe("0%");
  });

  it("点击行回调 onSelect，选中行带高亮类", async () => {
    defaultApi();
    const { onSelect } = renderList({ selectedId: "o-2" });
    await waitFor(() => expect(screen.getByText("Grow ARR")).toBeInTheDocument());

    const rows = screen.getAllByRole("listitem");
    expect(rows[1].className).toContain("bg-[var(--surface-2)]");
    expect(rows[0].className).toContain("hover:bg-[var(--surface-2)]");

    fireEvent.click(rows[0]);
    expect(onSelect).toHaveBeenCalledWith("o-1");
  });

  it("周期输入与状态选择触发带参重拉", async () => {
    defaultApi();
    renderList();
    await waitFor(() => expect(screen.getByText("Grow ARR")).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("okr:period"), { target: { value: "2026-Q1" } });
    await waitFor(() => expect(urls()).toHaveLength(2));
    expect(urls()[1]).toBe(`${BASE}?period=2026-Q1`);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "active" } });
    await waitFor(() => expect(urls()).toHaveLength(3));
    expect(urls()[2]).toBe(`${BASE}?period=2026-Q1&status=active`);
  });

  it("状态下拉含四档状态与占位", async () => {
    defaultApi();
    renderList();
    await waitFor(() => expect(screen.getByText("Grow ARR")).toBeInTheDocument());

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "okr:status",
      "okr:draft",
      "okr:active",
      "okr:completed",
      "okr:archived",
    ]);
    expect(select).toHaveValue("");
  });

  it("新建按钮回调 onCreate", async () => {
    defaultApi();
    const { onCreate } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "okr:create" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("空列表显示空态文案", async () => {
    defaultApi([]);
    renderList();
    await waitFor(() => expect(screen.getByText("okr:noObjectives")).toBeInTheDocument());
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("加载失败：Error 显示消息，非 Error 回退 noObjectives", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("list-boom");
    });
    const first = renderList();
    await waitFor(() => expect(screen.getByText("list-boom")).toBeInTheDocument());
    first.unmount();

    mocks.api.mockImplementation(async () => {
      throw { weird: true };
    });
    renderList();
    await waitFor(() => expect(screen.getAllByText("okr:noObjectives")).toHaveLength(2));
  });
});
