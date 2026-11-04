// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

import { TimeReport } from "@/components/timetrack/TimeReport";

const REPORT_BASE = "/api/v1/workspaces/ws-1/time-entries/report";

const report = {
  groups: [
    { key: "Alice", totalDuration: 5400, billableDuration: 3600, totalAmount: 120.5 },
    { key: "Bob", totalDuration: 1800, billableDuration: 0, totalAmount: 0 },
  ],
  summary: { totalDuration: 7200, billableDuration: 3600, totalAmount: 120.5 },
};

/** 与组件同式的本地日期 → ISO（组件用本地当日 00:00:00 / 23:59:59） */
function startISO(date: string): string {
  return new Date(date + "T00:00:00").toISOString();
}
function endISO(date: string): string {
  return new Date(date + "T23:59:59").toISOString();
}

const now = new Date();
const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
const defaultEnd = now.toISOString().slice(0, 10);

function paramsOf(call: unknown[]): URLSearchParams {
  const url = call[0] as string;
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
}

function paramsOfLast(): URLSearchParams {
  const calls = mocks.api.mock.calls;
  return paramsOf(calls[calls.length - 1]);
}

function dateInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
}

/**
 * 汇总卡数值：标签 span 的父行（图标+标签）之后紧跟数值 div。
 * 表头三列与汇总卡标签同名，取 DOM 序第一个（汇总卡在表格之前）。
 */
function cardValue(label: string): string | null {
  const el = screen.getAllByText(label)[0];
  return el.parentElement?.nextElementSibling?.textContent ?? null;
}

function defaultApi() {
  mocks.api.mockImplementation(async () => report);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TimeReport", () => {
  it("首次加载：默认本月区间与 groupBy=user 入参，加载中文案", () => {
    defaultApi();
    const { container } = render(<TimeReport wid="ws-1" />);
    expect(screen.getByText("timetrack:loading")).toBeInTheDocument();

    const [start, end] = dateInputs(container);
    expect(start).toHaveValue(defaultStart);
    expect(end).toHaveValue(defaultEnd);

    expect(mocks.api.mock.calls[0][0]).toContain(`${REPORT_BASE}?`);
    const params = paramsOf(mocks.api.mock.calls[0]);
    expect(params.get("startDate")).toBe(startISO(defaultStart));
    expect(params.get("endDate")).toBe(endISO(defaultEnd));
    expect(params.get("groupBy")).toBe("user");
  });

  it("汇总卡与分组表格按格式渲染", async () => {
    defaultApi();
    render(<TimeReport wid="ws-1" />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    // 汇总卡：总时长 / 计费时长 / 金额（两位小数）——金额与表格首行同值，须按卡片定位
    expect(cardValue("timetrack:totalDuration")).toBe("02:00:00");
    expect(cardValue("timetrack:billableDuration")).toBe("01:00:00");
    expect(cardValue("timetrack:totalAmount")).toBe("120.50");

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);

    const alice = within(rows[1]).getAllByRole("cell");
    expect(alice.map((c) => c.textContent)).toEqual(["Alice", "01:30:00", "01:00:00", "120.50"]);

    const bob = within(rows[2]).getAllByRole("cell");
    expect(bob.map((c) => c.textContent)).toEqual(["Bob", "00:30:00", "00:00:00", "0.00"]);
  });

  it("分组为空：显示空态且不渲染表格", async () => {
    mocks.api.mockImplementation(async () => ({
      groups: [],
      summary: { totalDuration: 0, billableDuration: 0, totalAmount: 0 },
    }));
    render(<TimeReport wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:noEntries")).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("响应为 null 时显示空态", async () => {
    mocks.api.mockImplementation(async () => null);
    render(<TimeReport wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:noEntries")).toBeInTheDocument());
  });

  it("加载失败：Error 显示消息，非 Error 回退 loadFailed", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("report-boom");
    });
    const first = render(<TimeReport wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("report-boom")).toBeInTheDocument());
    first.unmount();

    mocks.api.mockImplementation(async () => {
      throw "nope";
    });
    render(<TimeReport wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:loadFailed")).toBeInTheDocument());
  });

  it("切换分组维度与日期范围触发重新拉取", async () => {
    defaultApi();
    const { container } = render(<TimeReport wid="ws-1" />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "task" } });
    await waitFor(() => expect(paramsOfLast().get("groupBy")).toBe("task"));

    const start = dateInputs(container)[0];
    fireEvent.change(start, { target: { value: "2026-10-01" } });
    await waitFor(() => expect(paramsOfLast().get("startDate")).toBe(startISO("2026-10-01")));

    const [startInput] = dateInputs(container);
    expect(startInput).toHaveValue("2026-10-01");
    expect(paramsOfLast().get("groupBy")).toBe("task");
  });

  it("refreshKey 变化触发重新拉取", async () => {
    defaultApi();
    const { rerender } = render(<TimeReport wid="ws-1" refreshKey={1} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledTimes(1);

    rerender(<TimeReport wid="ws-1" refreshKey={2} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  });

  it("失败后修改筛选会清空错误并重新拉取", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("report-boom");
    });
    render(<TimeReport wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("report-boom")).toBeInTheDocument());

    defaultApi();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "day" } });
    await waitFor(() => expect(screen.queryByText("report-boom")).not.toBeInTheDocument());
    expect(paramsOfLast().get("groupBy")).toBe("day");
  });
});
