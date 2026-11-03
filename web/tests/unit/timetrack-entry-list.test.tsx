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

import { TimeEntryList } from "@/components/timetrack/TimeEntryList";

const LIST_PATH = "/api/v1/workspaces/ws-1/time-entries?limit=50";

const entries = [
  {
    id: "e-1",
    userId: "u-1",
    taskId: "t-1",
    startTime: "2026-10-31T08:00:00.000Z",
    endTime: "2026-10-31T09:30:00.000Z",
    duration: 5400,
    description: "Morning work",
    billable: true,
    hourlyRate: 100,
    task: { id: "t-1", title: "Write report" },
  },
  {
    id: "e-2",
    userId: "u-1",
    taskId: null,
    startTime: "2026-10-30T08:00:00.000Z",
    endTime: "2026-10-30T08:30:00.000Z",
    duration: 1800,
    description: null,
    billable: false,
    hourlyRate: 0,
    task: null,
  },
];

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function defaultApi(list: unknown[] = entries) {
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (path === LIST_PATH) return { items: list };
    if (opts?.method === "PATCH") return { ...entries[0], description: "updated" };
    if (opts?.method === "DELETE") return {};
    return {};
  });
}

function listGetCalls() {
  return mocks.api.mock.calls.filter(([p]) => p === LIST_PATH);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TimeEntryList", () => {
  it("加载中显示加载文案并请求列表接口", () => {
    defaultApi();
    render(<TimeEntryList wid="ws-1" />);
    expect(screen.getByText("timetrack:loading")).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(LIST_PATH);
  });

  it("列表渲染：时长、计费徽章、起止时间、任务、描述与时薪（0 不显示）", async () => {
    defaultApi();
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    expect(screen.getByText("00:30:00")).toBeInTheDocument();
    // 仅第一条为计费
    expect(screen.getAllByText("timetrack:billableYes")).toHaveLength(1);
    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText("Morning work")).toBeInTheDocument();
    expect(screen.getByText("timetrack:hourlyRate: 100/h")).toBeInTheDocument();
    expect(screen.queryByText(/timetrack:hourlyRate: 0\/h/)).not.toBeInTheDocument();

    // 两行都有起止时间，断言须限定到行作用域；日期用子串比对（不拼 RegExp，
    // 拼串转正则会被 CodeQL 判未转义反斜杠/双重转义）
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const firstRow = within(rows[0]);
    const start = new Date("2026-10-31T08:00:00.000Z").toLocaleString();
    const end = new Date("2026-10-31T09:30:00.000Z").toLocaleString();
    const timeLine = firstRow.getByText(/timetrack:startTime: /).textContent ?? "";
    expect(timeLine).toContain(`timetrack:startTime: ${start}`);
    expect(timeLine).toContain(`· timetrack:endTime: ${end}`);
  });

  it("空列表显示空态", async () => {
    defaultApi([]);
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:noEntries")).toBeInTheDocument());
  });

  it("加载失败：Error 显示消息，非 Error 回退 loadFailed", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("list-boom");
    });
    const first = render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("list-boom")).toBeInTheDocument());
    first.unmount();

    mocks.api.mockImplementation(async () => {
      throw { weird: true };
    });
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:loadFailed")).toBeInTheDocument());
  });

  it("refreshKey 变化触发重新拉取", async () => {
    defaultApi();
    const { rerender } = render(<TimeEntryList wid="ws-1" refreshKey={1} />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());
    expect(listGetCalls()).toHaveLength(1);

    rerender(<TimeEntryList wid="ws-1" refreshKey={2} />);
    await waitFor(() => expect(listGetCalls()).toHaveLength(2));
  });

  it("刷新按钮重新拉取并替换列表内容", async () => {
    defaultApi();
    const { container } = render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    mocks.api.mockImplementation(async () => ({
      items: [{ ...entries[0], id: "e-3", duration: 60, description: "fresh" }],
    }));
    fireEvent.click(within(container).getAllByRole("button")[0]);

    await waitFor(() => expect(screen.getByText("fresh")).toBeInTheDocument());
    expect(screen.getByText("00:01:00")).toBeInTheDocument();
    expect(screen.queryByText("01:30:00")).not.toBeInTheDocument();
    expect(listGetCalls()).toHaveLength(2);
  });

  it("删除：确认后 DELETE 并本地移除（不重发列表请求）", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("timetrack:delete")[0]);
    await waitFor(() => expect(screen.queryByText("Write report")).not.toBeInTheDocument());

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/time-entries/e-1", {
      method: "DELETE",
    });
    expect(screen.getByText("00:30:00")).toBeInTheDocument();
    expect(listGetCalls()).toHaveLength(1);
  });

  it("删除取消：不发起请求", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("timetrack:delete")[0]);
    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "DELETE")).toHaveLength(0),
    );
    expect(screen.getByText("Write report")).toBeInTheDocument();
  });

  it("删除失败：显示错误且列表不变", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") throw new Error("delete-boom");
      return { items: entries };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("timetrack:delete")[0]);
    await waitFor(() => expect(screen.getByText("delete-boom")).toBeInTheDocument());
    expect(screen.getByText("Write report")).toBeInTheDocument();
  });

  it("内联编辑保存：PATCH 载荷正确且就地替换（不重发列表请求）", async () => {
    defaultApi();
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("timetrack:edit")[0]);
    const numbers = screen.getAllByRole("spinbutton");
    // number 输入框的 toHaveValue 断言数值而非字符串
    expect(numbers[0]).toHaveValue(5400);
    expect(numbers[1]).toHaveValue(100);

    fireEvent.change(numbers[0], { target: { value: "7200" } });
    fireEvent.change(numbers[1], { target: { value: "150.5" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  updated  " } });
    fireEvent.click(screen.getByRole("button", { name: "timetrack:billableYes" }));
    fireEvent.click(screen.getByRole("button", { name: "timetrack:save" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "timetrack:save" })).toBeNull(),
    );
    const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(patch?.[0]).toBe("/api/v1/workspaces/ws-1/time-entries/e-1");
    expect(bodyOf(patch ?? [])).toEqual({
      description: "updated",
      billable: false,
      hourlyRate: 150.5,
      duration: 7200,
    });
    expect(screen.getByText("updated")).toBeInTheDocument();
    expect(listGetCalls()).toHaveLength(1);
  });

  it("内联编辑：清空字段提交为 null", async () => {
    defaultApi();
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("timetrack:edit")[0]);
    const numbers = screen.getAllByRole("spinbutton");
    fireEvent.change(numbers[0], { target: { value: "" } });
    fireEvent.change(numbers[1], { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "timetrack:save" }));

    await waitFor(() =>
      expect(mocks.api.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(true),
    );
    const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(bodyOf(patch ?? [])).toEqual({
      description: null,
      billable: true,
      hourlyRate: null,
      duration: null,
    });
  });

  it("内联编辑取消：回到展示行且不发请求", async () => {
    defaultApi();
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("timetrack:edit")[0]);
    fireEvent.click(screen.getByRole("button", { name: "timetrack:cancel" }));

    expect(screen.queryByRole("button", { name: "timetrack:save" })).toBeNull();
    expect(screen.getByText("01:30:00")).toBeInTheDocument();
    expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "PATCH")).toHaveLength(0);
  });

  it("内联编辑保存失败：显示错误并停留在编辑态", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") throw new Error("save-boom");
      return { items: entries };
    });
    render(<TimeEntryList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("01:30:00")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("timetrack:edit")[0]);
    fireEvent.click(screen.getByRole("button", { name: "timetrack:save" }));

    await waitFor(() => expect(screen.getByText("save-boom")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "timetrack:save" })).toBeEnabled();
    expect(screen.getByRole("textbox")).toHaveValue("Morning work");
  });
});
