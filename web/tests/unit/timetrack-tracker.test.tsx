// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

import { TimeTracker, formatDuration } from "@/components/timetrack/TimeTracker";

const BASE = "/api/v1/workspaces/ws-1";
const ENTRIES_PATH = `${BASE}/time-entries?limit=50`;
const TASKS_PATH = `${BASE}/tasks?limit=100`;
const START_PATH = `${BASE}/time-entries/start`;
const STOP_PATH = `${BASE}/time-entries/stop`;

const tasks = [
  { id: "t-1", title: "Write report" },
  { id: "t-2", title: "Review PR" },
];

const finishedEntry = {
  id: "e-1",
  userId: "u-1",
  taskId: null,
  startTime: "2026-11-01T09:00:00.000Z",
  endTime: "2026-11-01T10:00:00.000Z",
  duration: 3600,
  description: "done",
  billable: false,
  hourlyRate: null,
};

const runningEntry = {
  id: "e-9",
  userId: "u-1",
  taskId: "t-1",
  startTime: "2026-11-03T00:00:00.000Z",
  endTime: null,
  duration: null,
  description: "in progress",
  billable: true,
  hourlyRate: 120,
  task: { id: "t-1", title: "Write report" },
};

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function defaultApi(entries: unknown[] = [], taskList: unknown[] = tasks) {
  mocks.api.mockImplementation(async (path: string) => {
    if (path === ENTRIES_PATH) return { items: entries };
    if (path === TASKS_PATH) return { items: taskList };
    if (path === START_PATH) return runningEntry;
    if (path === STOP_PATH) return { ...runningEntry, endTime: "2026-11-03T01:00:00.000Z" };
    return {};
  });
}

function postCalls(path: string) {
  return mocks.api.mock.calls.filter(([p, o]) => p === path && o?.method === "POST");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("formatDuration", () => {
  it("秒数格式化为 HH:MM:SS 并补零", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(59)).toBe("00:00:59");
    expect(formatDuration(60)).toBe("00:01:00");
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatDuration(360_000)).toBe("100:00:00");
  });
});

describe("TimeTracker", () => {
  it("加载中显示加载文案并请求计时与任务两个接口", () => {
    defaultApi([], []);
    render(<TimeTracker wid="ws-1" />);
    expect(screen.getByText("timetrack:loading")).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(ENTRIES_PATH);
    expect(mocks.api).toHaveBeenCalledWith(TASKS_PATH);
  });

  it("无进行中计时：显示 00:00:00、开始按钮与表单", async () => {
    defaultApi([finishedEntry], []);
    render(<TimeTracker wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:start")).toBeInTheDocument());

    expect(screen.getByText("00:00:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "timetrack:start" })).toBeEnabled();
    expect(screen.queryByText("timetrack:running")).not.toBeInTheDocument();
    // 没有任务时不渲染任务下拉
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("有任务时渲染任务下拉（含 noTask 占位）", async () => {
    defaultApi([], tasks);
    render(<TimeTracker wid="ws-1" />);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "timetrack:noTask",
      "Write report",
      "Review PR",
    ]);
  });

  it("存在 endTime=null 的条目即进入计时态：预填关联信息且隐藏表单", async () => {
    defaultApi([finishedEntry, runningEntry], tasks);
    render(<TimeTracker wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:running")).toBeInTheDocument());

    expect(screen.getByText("timetrack:stop")).toBeInTheDocument();
    expect(screen.getByText("Write report")).toBeInTheDocument();
    expect(screen.getByText("in progress")).toBeInTheDocument();
    expect(screen.getByText("timetrack:billableYes")).toBeInTheDocument();
    expect(screen.getByText(/· 120\/h/)).toBeInTheDocument();
    // 计时中隐藏表单
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("开始计时：POST 载荷含关联任务/描述/计费/时薪，成功后进入计时态", async () => {
    defaultApi([], tasks);
    render(<TimeTracker wid="ws-1" />);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "t-2" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  drafting  " } });
    fireEvent.click(screen.getByRole("button", { name: "timetrack:billableNo" }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "88.5" } });
    fireEvent.click(screen.getByRole("button", { name: "timetrack:start" }));

    await waitFor(() => expect(postCalls(START_PATH)).toHaveLength(1));
    expect(bodyOf(postCalls(START_PATH)[0])).toEqual({
      taskId: "t-2",
      description: "drafting",
      billable: true,
      hourlyRate: 88.5,
    });
    await waitFor(() => expect(screen.getByText("timetrack:running")).toBeInTheDocument());
    expect(screen.getByText("timetrack:stop")).toBeInTheDocument();
  });

  it("开始计时：空描述与未选任务时省略对应键", async () => {
    defaultApi([], []);
    render(<TimeTracker wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:start")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "timetrack:start" }));

    await waitFor(() => expect(postCalls(START_PATH)).toHaveLength(1));
    expect(bodyOf(postCalls(START_PATH)[0])).toEqual({ billable: false });
  });

  it("开始失败：显示错误并恢复按钮可用", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === ENTRIES_PATH || path === TASKS_PATH) return { items: [] };
      throw new Error("start-boom");
    });
    render(<TimeTracker wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:start")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "timetrack:start" }));
    await waitFor(() => expect(screen.getByText("start-boom")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "timetrack:start" })).toBeEnabled();
    expect(screen.queryByText("timetrack:running")).not.toBeInTheDocument();
  });

  it("停止计时：POST 携带 teid、回调 onStopped 并重置表单", async () => {
    defaultApi([runningEntry], tasks);
    const onStopped = vi.fn();
    render(<TimeTracker wid="ws-1" onStopped={onStopped} />);
    await waitFor(() => expect(screen.getByText("timetrack:stop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "timetrack:stop" }));
    await waitFor(() => expect(onStopped).toHaveBeenCalledTimes(1));

    expect(bodyOf(postCalls(STOP_PATH)[0])).toEqual({ teid: "e-9" });
    expect(screen.getByText("00:00:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "timetrack:start" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "timetrack:billableNo" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("停止失败：非 Error 抛出回退到 stopFailed 文案且仍在计时", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === ENTRIES_PATH) return { items: [runningEntry] };
      if (path === TASKS_PATH) return { items: tasks };
      throw "boom";
    });
    render(<TimeTracker wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("timetrack:stop")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "timetrack:stop" }));
    await waitFor(() => expect(screen.getByText("timetrack:stopFailed")).toBeInTheDocument());
    expect(screen.getByText("timetrack:running")).toBeInTheDocument();
  });

  it("计时显示按秒递增（假时钟 65 秒）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T00:00:00.000Z"));
    try {
      defaultApi([runningEntry], tasks);
      render(<TimeTracker wid="ws-1" />);
      await act(async () => {});
      expect(screen.getByText("00:00:00")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(65_000);
      });
      expect(screen.getByText("00:01:05")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("辅助接口返回空载荷时走错误分支（外层 catch）", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === ENTRIES_PATH) return { items: [] };
      if (path === TASKS_PATH) return null;
      return {};
    });
    render(<TimeTracker wid="ws-1" />);
    await waitFor(() => expect(screen.getByText(/Cannot read/)).toBeInTheDocument());
  });
});
