// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    onClose: vi.fn(),
    onSaved: vi.fn(),
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
  return { useTranslations };
});

vi.mock("@/lib/api", () => ({
  api: mocks.api,
  ApiError: mocks.ApiErrorClass,
}));

import { CalendarEventDialog, type CalendarEvent } from "@/components/calendar/CalendarEventDialog";

const BASE_EVENT: CalendarEvent = {
  id: "evt-1",
  title: "既有事件",
  description: "描述文本",
  startAt: new Date(2026, 9, 1, 9, 0).toISOString(),
  endAt: new Date(2026, 9, 1, 10, 0).toISOString(),
  allDay: false,
  location: "会议室B",
  color: "var(--danger)",
  createdBy: "u1",
  createdAt: new Date(2026, 9, 1, 9, 0).toISOString(),
  updatedAt: new Date(2026, 9, 1, 9, 0).toISOString(),
  source: "event",
};

function renderDialog(event: CalendarEvent | null) {
  return render(
    <CalendarEventDialog
      wid="ws-1"
      event={event}
      onClose={mocks.onClose}
      onSaved={mocks.onSaved}
    />,
  );
}

/** 取保存/删除按钮调用的参数 */
function lastCall() {
  const calls = mocks.api.mock.calls;
  return calls[calls.length - 1] as [string, { method: string; body?: string }];
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.onClose.mockReset();
  mocks.onSaved.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CalendarEventDialog", () => {
  it("新建模式：aria-label 为 newEvent 文案、不渲染删除按钮", () => {
    renderDialog(null);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "calendar:newEvent");
    expect(screen.getByText("calendar:newEvent")).toBeTruthy();
    expect(screen.queryByText("calendar:deleteEvent")).toBeNull();
  });

  it("新建模式：默认起止时间为当前整点与下一小时（本地时区无关）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 9, 5, 30));
    renderDialog(null);
    expect(screen.getByLabelText("calendar:startDate")).toHaveValue("2026-10-01T09:00");
    expect(screen.getByLabelText("calendar:endDate")).toHaveValue("2026-10-01T10:00");
  });

  it("编辑模式：字段回填、aria-label 为 editEvent、渲染删除按钮", () => {
    renderDialog(BASE_EVENT);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "calendar:editEvent");
    expect(screen.getByLabelText("calendar:eventTitle")).toHaveValue("既有事件");
    expect(screen.getByLabelText("calendar:eventDescription")).toHaveValue("描述文本");
    expect(screen.getByLabelText("calendar:startDate")).toHaveValue("2026-10-01T09:00");
    expect(screen.getByLabelText("calendar:endDate")).toHaveValue("2026-10-01T10:00");
    expect(screen.getByLabelText("calendar:allDay")).not.toBeChecked();
    expect(screen.getByLabelText("calendar:location")).toHaveValue("会议室B");
    expect(screen.getByLabelText("calendar:color")).toHaveValue("var(--danger)");
    expect(screen.getByText("calendar:deleteEvent")).toBeTruthy();
  });

  it("标题为空时保存被拦截：显示 eventTitle 校验提示且不调用 API", () => {
    const { container } = renderDialog(null);
    fireEvent.click(screen.getByText("calendar:save"));
    const error = container.querySelector('p[style*="color: var(--danger)"]');
    expect(error?.textContent).toBe("calendar:eventTitle");
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.onSaved).not.toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("新建保存：POST 正确 URL 与载荷（空描述/地点/颜色剔除、标题去空白）", async () => {
    renderDialog(null);
    fireEvent.change(screen.getByLabelText("calendar:eventTitle"), {
      target: { value: "  新事件  " },
    });
    fireEvent.change(screen.getByLabelText("calendar:startDate"), {
      target: { value: "2026-10-01T09:00" },
    });
    fireEvent.change(screen.getByLabelText("calendar:endDate"), {
      target: { value: "2026-10-01T10:00" },
    });
    fireEvent.click(screen.getByText("calendar:save"));
    await waitFor(() => expect(mocks.onSaved).toHaveBeenCalledTimes(1));
    const [url, opts] = lastCall();
    expect(url).toBe("/api/v1/workspaces/ws-1/calendar/events");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      title: "新事件",
      startAt: new Date(2026, 9, 1, 9, 0).toISOString(),
      endAt: new Date(2026, 9, 1, 10, 0).toISOString(),
      allDay: false,
    });
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("编辑保存：PATCH 目标 URL 含事件 id，载荷含描述/地点/颜色（去空白）", async () => {
    renderDialog(BASE_EVENT);
    fireEvent.change(screen.getByLabelText("calendar:location"), {
      target: { value: " 会议室C " },
    });
    fireEvent.click(screen.getByText("calendar:save"));
    await waitFor(() => expect(mocks.onSaved).toHaveBeenCalledTimes(1));
    const [url, opts] = lastCall();
    expect(url).toBe("/api/v1/workspaces/ws-1/calendar/events/evt-1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({
      title: "既有事件",
      description: "描述文本",
      startAt: new Date(2026, 9, 1, 9, 0).toISOString(),
      endAt: new Date(2026, 9, 1, 10, 0).toISOString(),
      allDay: false,
      location: "会议室C",
      color: "var(--danger)",
    });
  });

  it("保存失败（ApiError）：显示后端报错文案且弹窗保持打开", async () => {
    mocks.api.mockRejectedValueOnce(new mocks.ApiErrorClass("后端冲突"));
    renderDialog(BASE_EVENT);
    fireEvent.click(screen.getByText("calendar:save"));
    await waitFor(() => expect(screen.getByText("后端冲突")).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.onSaved).not.toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("保存失败（非 ApiError）：回退 saveError 词条", async () => {
    mocks.api.mockRejectedValueOnce(new Error("network"));
    renderDialog(BASE_EVENT);
    fireEvent.click(screen.getByText("calendar:save"));
    await waitFor(() => expect(screen.getByText("calendar:saveError")).toBeTruthy());
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("保存中：按钮禁用且文案变为 “…”", async () => {
    let resolveSave: ((v: { ok: true }) => void) | undefined;
    mocks.api.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderDialog(null);
    fireEvent.change(screen.getByLabelText("calendar:eventTitle"), { target: { value: "进行中" } });
    fireEvent.click(screen.getByText("calendar:save"));
    await waitFor(() => expect(screen.getByText("…")).toBeTruthy());
    expect((screen.getByText("…").closest("button") as HTMLButtonElement).disabled).toBe(true);
    resolveSave?.({ ok: true });
    await waitFor(() => expect(mocks.onSaved).toHaveBeenCalledTimes(1));
  });

  it("取消按钮、关闭按钮与 ESC 键均触发 onClose", () => {
    renderDialog(null);
    fireEvent.click(screen.getByText("calendar:cancel"));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("close"));
    expect(mocks.onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(mocks.onClose).toHaveBeenCalledTimes(3);
  });

  it("点击遮罩层关闭、点击弹窗本体不关闭", () => {
    const { container } = renderDialog(null);
    const overlay = container.querySelector('[role="presentation"]') as HTMLElement;
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(mocks.onClose).not.toHaveBeenCalled();
    fireEvent.click(overlay);
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("删除：确认后调用 DELETE 目标 URL 并回调关闭/保存", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog(BASE_EVENT);
    fireEvent.click(screen.getByText("calendar:deleteEvent"));
    expect(confirmSpy).toHaveBeenCalledWith("calendar:deleteConfirm");
    await waitFor(() => expect(mocks.onSaved).toHaveBeenCalledTimes(1));
    const [url, opts] = lastCall();
    expect(url).toBe("/api/v1/workspaces/ws-1/calendar/events/evt-1");
    expect(opts.method).toBe("DELETE");
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it("删除：confirm 取消则不调用 API", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog(BASE_EVENT);
    fireEvent.click(screen.getByText("calendar:deleteEvent"));
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("删除失败：显示 ApiError 报错文案且弹窗保持打开", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.api.mockRejectedValueOnce(new mocks.ApiErrorClass("删除被拒"));
    renderDialog(BASE_EVENT);
    fireEvent.click(screen.getByText("calendar:deleteEvent"));
    await waitFor(() => expect(screen.getByText("删除被拒")).toBeTruthy());
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it("FocusTrap 挂载即聚焦标题输入框（data-autofocus）", () => {
    renderDialog(null);
    expect(document.activeElement).toBe(screen.getByLabelText("calendar:eventTitle"));
  });
});
