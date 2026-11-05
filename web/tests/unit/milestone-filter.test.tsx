// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * MilestoneFilter 契约（components/MilestoneFilter.tsx）：
 *  - 挂载拉取 /api/v1/workspaces/{wid}/milestones
 *  - loading → spinner 占位（filterLabel，无触发按钮）
 *  - 失败 → filterError 错误提示；里程碑为空 → 渲染 null
 *  - 触发按钮 current 文案：all → filterAll；"null" → filterUnassigned；里程碑 id → 其名；
 *    未知 id → 回退 filterAll
 *  - 打开：role=listbox + 选项（all/null/里程碑，aria-selected），rAF 聚焦当前项
 *  - 选择 → onChange(v) + 关闭 + 焦点回触发按钮
 *  - Escape 关闭 + 焦点回触发按钮；点击遮罩关闭；ArrowDown/ArrowUp 移动焦点
 *  - 里程碑 dueDate → toLocaleDateString
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
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

vi.mock("@/lib/api", () => ({ api: mocks.api }));

import { MilestoneFilter } from "@/components/MilestoneFilter";

const MS_A = { id: "ms-a", name: "M1 迭代" };
const MS_B = { id: "ms-b", name: "M2 发布", dueDate: "2026-11-20T00:00:00.000Z" };

type FilterProps = Parameters<typeof MilestoneFilter>[0];

function renderFilter(overrides: Partial<FilterProps> = {}) {
  const props: FilterProps = { wid: "ws-1", value: "all", onChange: vi.fn(), ...overrides };
  return render(<MilestoneFilter {...props} />);
}

const openListbox = async () => {
  fireEvent.click(screen.getByRole("button"));
  return await screen.findByRole("listbox");
};

const getOptions = () =>
  Array.from(screen.getByRole("listbox").querySelectorAll<HTMLButtonElement>('[role="option"]'));

beforeEach(() => {
  mocks.api.mockReset();
  mocks.api.mockResolvedValue([MS_A, MS_B]);
  // 本仓 jsdom 无 requestAnimationFrame：立即执行，焦点断言确定性
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MilestoneFilter", () => {
  it("加载中：显示 filterLabel spinner 占位，无触发按钮", async () => {
    let resolveApi: (v: unknown) => void = () => {};
    mocks.api.mockReturnValue(
      new Promise((resolve) => {
        resolveApi = resolve;
      }),
    );
    const { container } = renderFilter();
    expect(screen.getByText("milestone:filterLabel")).toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
    resolveApi([]);
  });

  it("加载完成：触发按钮显示 filterLabel + current（all → filterAll），并请求正确的 API", async () => {
    renderFilter({ wid: "ws-9" });
    const trigger = await screen.findByRole("button");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("milestone:filterLabel");
    expect(trigger).toHaveTextContent("milestone:filterAll");
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-9/milestones");
  });

  it('value="null" → current 显示 filterUnassigned', async () => {
    renderFilter({ value: "null" });
    const trigger = await screen.findByRole("button");
    expect(trigger).toHaveTextContent("milestone:filterUnassigned");
  });

  it("value=里程碑 id → current 显示该里程碑名", async () => {
    renderFilter({ value: "ms-b" });
    const trigger = await screen.findByRole("button");
    expect(trigger).toHaveTextContent("M2 发布");
  });

  it("value 为未知 id → current 回退 filterAll", async () => {
    renderFilter({ value: "ms-gone" });
    const trigger = await screen.findByRole("button");
    expect(trigger).toHaveTextContent("milestone:filterAll");
  });

  it("打开：aria-expanded=true + listbox 含 all/null/里程碑 4 个选项，当前项 aria-selected", async () => {
    renderFilter({ value: "ms-a" });
    await screen.findByRole("button");
    await openListbox();
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    const options = getOptions();
    expect(options).toHaveLength(4);
    expect(options[0].textContent).toBe("milestone:filterAll");
    expect(options[1].textContent).toBe("milestone:filterUnassigned");
    expect(options[2].textContent).toBe("M1 迭代");
    // M2 带 dueDate：textContent 还含本地化日期，断言锚定名称前缀
    expect(options[3].textContent).toContain("M2 发布");
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("打开后聚焦当前选中项", async () => {
    renderFilter({ value: "ms-b" });
    await screen.findByRole("button");
    await openListbox();
    expect(getOptions()[3]).toHaveFocus();
  });

  it("选择选项（里程碑与 null）→ onChange + 关闭 + 焦点回触发按钮", async () => {
    const onChange = vi.fn();
    renderFilter({ onChange, value: "all" });
    await screen.findByRole("button");
    await openListbox();

    const options = getOptions();
    fireEvent.click(options[2]); // M1 迭代
    expect(onChange).toHaveBeenCalledWith("ms-a");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveFocus();

    await openListbox();
    fireEvent.click(getOptions()[1]); // 未归入里程碑
    expect(onChange).toHaveBeenCalledWith("null");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Escape → 关闭下拉 + 焦点回触发按钮 + 不触发 onChange", async () => {
    const onChange = vi.fn();
    renderFilter({ onChange });
    await screen.findByRole("button");
    const listbox = await openListbox();
    expect(getOptions()[0]).toHaveFocus();
    fireEvent.keyDown(listbox, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("点击遮罩（fixed 覆盖层）→ 关闭下拉", async () => {
    const { container } = renderFilter();
    await screen.findByRole("button");
    await openListbox();
    const overlay = container.querySelector("div.fixed");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("API 失败 → 显示 filterError 错误态（无触发按钮）", async () => {
    mocks.api.mockRejectedValue(new Error("network down"));
    const { container } = renderFilter();
    expect(await screen.findByText("milestone:filterError")).toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
  });

  it("里程碑列表为空 → 渲染 null（不占视觉空间）", async () => {
    mocks.api.mockResolvedValue([]);
    const { container } = renderFilter();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("带 dueDate 的里程碑选项显示本地化日期", async () => {
    renderFilter();
    await screen.findByRole("button");
    await openListbox();
    const expected = new Date("2026-11-20T00:00:00.000Z").toLocaleDateString();
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("ArrowDown → 焦点移到下一选项（循环）", async () => {
    renderFilter({ value: "all" });
    await screen.findByRole("button");
    await openListbox();
    const options = getOptions();
    expect(options[0]).toHaveFocus(); // rAF 聚焦当前项（索引 0）
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(options[1]).toHaveFocus();
  });
});
