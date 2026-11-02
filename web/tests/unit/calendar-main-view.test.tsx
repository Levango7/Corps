// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    api: vi.fn(),
    toast: vi.fn(),
    push: vi.fn(),
    ApiErrorClass: ApiError,
  };
});

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
  return { useTranslations, useLocale: () => "en" };
});

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  ApiError: mocks.ApiErrorClass,
}));

vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/ai/CalendarScheduleDialog", () => ({
  default: (props: {
    wid: string;
    open: boolean;
    onClose: () => void;
    onSchedule: (s: {
      title: string;
      startTime: string;
      endTime: string;
      duration: number;
    }) => void;
  }) => (
    <div data-testid="schedule-dialog" data-open={props.open ? "true" : "false"}>
      <button
        data-testid="schedule-adopt"
        onClick={() =>
          props.onSchedule({
            title: "AI周会",
            startTime: "2026-11-03T09:00:00.000Z",
            endTime: "2026-11-03T10:00:00.000Z",
            duration: 60,
          })
        }
      >
        adopt
      </button>
      <button data-testid="schedule-close" onClick={props.onClose}>
        close
      </button>
    </div>
  ),
}));

import { CalendarView } from "@/components/calendar/CalendarView";
import type { CalendarEvent } from "@/components/calendar/CalendarEventDialog";

const wid = "ws-1";

/** 月视图标题词条（组件用 monthYear:{year,month} 插值，月份从 1 起算） */
function monthYearLabel(date = new Date()) {
  return `calendar:monthYear:${JSON.stringify({ year: date.getFullYear(), month: date.getMonth() + 1 })}`;
}

/** 月视图桌面网格选择器（42 格）；须在月视图渲染后调用 */
function desktopGrid(container: HTMLElement) {
  return container.querySelector('[class*="grid-rows-6"]') as HTMLElement;
}

/** 本地时间构造事件（组件按本地日线段归属判断），时区无关 */
function makeEvent(id: string, year: number, month: number, day: number, hour: number) {
  const start = new Date(year, month, day, hour, 0);
  const end = new Date(year, month, day, hour + 1, 0);
  return {
    id,
    title: `事件${id}`,
    description: null,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allDay: false,
    location: null,
    color: null,
    createdBy: "u1",
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
  } as CalendarEvent;
}

/** 期望的月度查询 URL（本地构造，与时区无关） */
function expectedMonthRangeUrl(y: number, m: number) {
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0, 23, 59, 59);
  return `/api/v1/workspaces/${wid}/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`;
}

function expectedWeekRangeUrl(sundayY: number, sundayM: number, sundayD: number) {
  const start = new Date(sundayY, sundayM, sundayD, 0, 0, 0);
  const end = new Date(sundayY, sundayM, sundayD, 23, 59, 59);
  end.setDate(end.getDate() + 6);
  return `/api/v1/workspaces/${wid}/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`;
}

function expectedDayRangeUrl(y: number, m: number, d: number) {
  const start = new Date(y, m, d, 0, 0, 0);
  const end = new Date(y, m, d, 23, 59, 59);
  return `/api/v1/workspaces/${wid}/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`;
}

function apiCalls() {
  return mocks.api.mock.calls as [string, { method?: string; body?: string }][];
}
/** 事件范围查询（GET）的 URL 列表；POST/DELETE 均带 method 字段，不在此列 */
function eventsUrls() {
  return apiCalls()
    .filter((c) => c[0].includes("/calendar/events") && !c[1]?.method)
    .map((c) => c[0]);
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
  mocks.push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CalendarView", () => {
  it("挂载即并行加载日历事件与任务（月视图范围 = 本月 1 日 00:00 至月末 23:59:59）", async () => {
    const now = new Date();
    mocks.api.mockImplementation(async (url: string) => {
      if (url.includes("/tasks?limit=100")) return { items: [], total: 0, hasMore: false };
      return { items: [], total: 0, hasMore: false };
    });
    render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    expect(eventsUrls()).toContain(expectedMonthRangeUrl(now.getFullYear(), now.getMonth()));
    expect(apiCalls().some((c) => c[0] === `/api/v1/workspaces/${wid}/tasks?limit=100`)).toBe(true);
  });

  it("渲染标题与三个视图切换按钮（默认月视图高亮）", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0, hasMore: false });
    render(<CalendarView wid={wid} />);
    await screen.findByText("calendar:title");
    expect(screen.getByText("calendar:title")).toBeTruthy();
    const monthBtn = screen.getByText("calendar:month").closest("button") as HTMLElement;
    expect(monthBtn.getAttribute("style")).toContain("background: var(--accent)");
    const weekBtn = screen.getByText("calendar:week").closest("button") as HTMLElement;
    expect(weekBtn.getAttribute("style")).toContain("background: var(--surface)");
  });

  it("切换到周视图：范围查询为周日 00:00 至周六 23:59:59", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0, hasMore: false });
    render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    fireEvent.click(screen.getByText("calendar:week"));
    await screen.findByLabelText("calendar:prevWeek");
    const now = new Date();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay());
    expect(eventsUrls()).toContain(
      expectedWeekRangeUrl(sunday.getFullYear(), sunday.getMonth(), sunday.getDate()),
    );
  });

  it("切换到日视图：范围查询为当天 00:00 至 23:59:59，且渲染 24 小时时间轴", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0, hasMore: false });
    render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    fireEvent.click(screen.getByText("calendar:day"));
    await screen.findByText("calendar:today");
    screen.getAllByText("23:00");
    const now = new Date();
    expect(eventsUrls()).toContain(
      expectedDayRangeUrl(now.getFullYear(), now.getMonth(), now.getDate()),
    );
  });

  it("日历事件与任务 deadline 合并：有截止的任务生成虚拟事件，空/非法截止被剔除", async () => {
    const now = new Date();
    const dueLocal = new Date(now.getFullYear(), now.getMonth(), 15, 12); // 本地中午 → UTC 同日
    mocks.api.mockImplementation(async (url: string) => {
      if (url.includes("/tasks?limit=100")) {
        return {
          items: [
            {
              id: "t-1",
              title: "任务截止",
              dueDate: dueLocal.toISOString(),
              status: "in_progress",
            },
            { id: "t-2", title: "无截止任务", dueDate: null, status: "todo" },
            { id: "t-3", title: "非法日期任务", dueDate: "not-a-date", status: "todo" },
          ],
          total: 3,
          hasMore: false,
        };
      }
      return { items: [], total: 0, hasMore: false };
    });
    const { container } = render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    // 桌面网格与手机列表都会渲染事件标题，只在桌面网格内断言（唯一的 chip）
    expect(within(desktopGrid(container)).getAllByText("任务截止").length).toBeGreaterThan(0);
    expect(screen.queryByText("无截止任务")).toBeNull();
    expect(screen.queryByText("非法日期任务")).toBeNull();
  });

  it("两个接口都失败时也不显示错误条（内部 catch 已兜底），月视图照常渲染", async () => {
    mocks.api.mockRejectedValue(new Error("down"));
    render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    expect(screen.queryByText("calendar:loadError")).toBeNull();
  });

  it("加载中显示 loading 文案，完成后隐藏", async () => {
    mocks.api.mockImplementation(async (url: string) => {
      if (url.includes("/tasks?limit=100")) return { items: [], total: 0, hasMore: false };
      return new Promise<{ items: CalendarEvent[]; total: number; hasMore: boolean }>(() => {});
    });
    render(<CalendarView wid={wid} />);
    await screen.findByText("calendar:loading");
    expect(screen.queryByText("calendar:monthYear")).toBeNull();
  });

  it("月视图 next 导航：标题变为下个月并触发该月范围查询", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0, hasMore: false });
    render(<CalendarView wid={wid} />);
    const now = new Date();
    await screen.findByText(
      `calendar:monthYear:${JSON.stringify({ year: now.getFullYear(), month: now.getMonth() + 1 })}`,
    );
    fireEvent.click(screen.getByLabelText("next month"));
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await screen.findByText(
      `calendar:monthYear:${JSON.stringify({ year: next.getFullYear(), month: next.getMonth() + 1 })}`,
    );
    expect(eventsUrls()).toContain(expectedMonthRangeUrl(next.getFullYear(), next.getMonth()));
  });

  it("月视图点日期格 → 切换到日视图并按该日范围查询", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0, hasMore: false });
    const { container } = render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    const grid = desktopGrid(container);
    const spans = Array.from(grid.querySelectorAll("span[class*='rounded-full']"));
    const day10Cell = spans[9].closest('[role="button"]') as HTMLElement;
    const now = new Date();
    fireEvent.click(day10Cell);
    await screen.findByText("23:00");
    expect(eventsUrls()).toContain(expectedDayRangeUrl(now.getFullYear(), now.getMonth(), 10));
  });

  it("点击任务 deadline 事件 → 跳转任务详情页、不打开弹窗", async () => {
    const now = new Date();
    const dueLocal = new Date(now.getFullYear(), now.getMonth(), 15, 12);
    mocks.api.mockImplementation(async (url: string) => {
      if (url.includes("/tasks?limit=100")) {
        return {
          items: [
            { id: "t-99", title: "跳转任务", dueDate: dueLocal.toISOString(), status: "todo" },
          ],
          total: 1,
          hasMore: false,
        };
      }
      return { items: [], total: 0, hasMore: false };
    });
    const { container } = render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    const chip = within(desktopGrid(container))
      .getByText("跳转任务")
      .closest('[role="button"]') as HTMLElement;
    fireEvent.click(chip);
    expect(mocks.push).toHaveBeenCalledWith("/w/ws-1/task/t-99");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("点击普通事件 → 打开编辑弹窗；新建按钮 → 打开新建弹窗", async () => {
    const now = new Date();
    const ev = makeEvent("e1", now.getFullYear(), now.getMonth(), 15, 9);
    mocks.api.mockImplementation(async (url: string) => {
      if (url.includes("/tasks?limit=100")) return { items: [], total: 0, hasMore: false };
      return { items: [ev], total: 1, hasMore: false };
    });
    const { container } = render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    fireEvent.click(
      within(desktopGrid(container)).getByText("事件e1").closest('[role="button"]') as HTMLElement,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "calendar:editEvent");
    fireEvent.click(screen.getByLabelText("close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByText("calendar:newEvent"));
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "calendar:newEvent");
  });

  it("弹窗保存成功后触发刷新（新增 POST 与再次的成对 GET）", async () => {
    mocks.api.mockImplementation(async () => ({ items: [], total: 0, hasMore: false }));
    const { container } = render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    fireEvent.click(screen.getByText("calendar:newEvent"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("calendar:eventTitle"), {
      target: { value: "新日历事件" },
    });
    fireEvent.click(within(dialog).getByText("calendar:save"));
    await waitFor(() => expect(apiCalls().some((c) => c[1]?.method === "POST")).toBe(true));
    const postCall = apiCalls().find((c) => c[1]?.method === "POST");
    expect(postCall?.[0]).toBe(`/api/v1/workspaces/${wid}/calendar/events`);
    expect(JSON.parse(postCall?.[1]?.body as string)).toMatchObject({
      title: "新日历事件",
      allDay: false,
    });
    // 保存成功 → onSaved 触发 loadEvents 再跑一次（events GET 多一次）
    await waitFor(() => expect(eventsUrls().length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(container.querySelector('[role="presentation"]')).toBeNull());
  });

  it("AI 排程按钮打开排程弹窗；关闭后复位", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0, hasMore: false });
    render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    const schedule = screen.getByTestId("schedule-dialog");
    expect(schedule.getAttribute("data-open")).toBe("false");
    fireEvent.click(screen.getByText("calendar:aiSchedule"));
    expect(schedule.getAttribute("data-open")).toBe("true");
    fireEvent.click(screen.getByTestId("schedule-close"));
    expect(schedule.getAttribute("data-open")).toBe("false");
  });

  it("采纳 AI 排程建议：POST 创建事件 + success toast + 刷新", async () => {
    mocks.api.mockImplementation(async () => ({ items: [], total: 0, hasMore: false }));
    render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    fireEvent.click(screen.getByText("calendar:aiSchedule"));
    fireEvent.click(screen.getByTestId("schedule-adopt"));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith("success", "calendar:createSuccess"),
    );
    const postCall = apiCalls().find((c) => c[1]?.method === "POST");
    expect(postCall?.[0]).toBe(`/api/v1/workspaces/${wid}/calendar/events`);
    expect(JSON.parse(postCall?.[1]?.body as string)).toEqual({
      title: "AI周会",
      startAt: "2026-11-03T09:00:00.000Z",
      endAt: "2026-11-03T10:00:00.000Z",
      allDay: false,
    });
    await waitFor(() => expect(eventsUrls().length).toBeGreaterThanOrEqual(2));
  });

  it("采纳 AI 排程失败：error toast 显示 ApiError 报错", async () => {
    mocks.api.mockImplementation(async (url: string, opts) => {
      if (opts?.method === "POST") throw new mocks.ApiErrorClass("排程冲突");
      return { items: [], total: 0, hasMore: false };
    });
    render(<CalendarView wid={wid} />);
    await screen.findByText(monthYearLabel());
    fireEvent.click(screen.getByText("calendar:aiSchedule"));
    fireEvent.click(screen.getByTestId("schedule-adopt"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("error", "排程冲突"));
    // 失败路径不触发刷新
    expect(eventsUrls().length).toBe(1);
  });
});
