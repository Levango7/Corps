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

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), ApiErrorClass: ApiError, push: vi.fn() };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));
vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { MinutesList } from "@/components/minutes/MinutesList";

const LIST_PATH = "/api/v1/workspaces/ws-1/meeting-minutes";

const items = [
  {
    id: "m-1",
    meetingId: "meet-1",
    title: "Weekly sync",
    attendees: [{ name: "Alice", role: "host" }, { name: "Bob" }],
    actionItems: [
      { title: "A", done: true },
      { title: "B", done: false },
      { title: "C", done: true },
    ],
    createdBy: "u-1",
    createdAt: "2026-11-01T10:00:00Z",
    updatedAt: "2026-11-01T10:00:00Z",
    creator: { id: "u-1", name: null, email: "creator@example.com" },
  },
  {
    id: "m-2",
    meetingId: null,
    title: "Retro",
    attendees: [],
    actionItems: [],
    createdBy: null,
    createdAt: "2026-11-02T10:00:00Z",
    updatedAt: "2026-11-02T10:00:00Z",
    creator: null,
  },
];

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function defaultApi(list: unknown[] = items) {
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (opts?.method === "POST") return { id: "m-9" };
    if (opts?.method === "DELETE") return {};
    if (path === LIST_PATH) return { items: list };
    return {};
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.push.mockClear();
});

describe("MinutesList", () => {
  it("加载中显示加载文案并拉列表", () => {
    defaultApi();
    render(<MinutesList wid="ws-1" />);
    expect(screen.getByText("minutes:loading")).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith(LIST_PATH);
  });

  it("列表渲染标题/参会人数/行动项完成比/创建人与时间", async () => {
    defaultApi();
    render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Weekly sync")).toBeInTheDocument());

    expect(screen.getByText("Retro")).toBeInTheDocument();
    // 参会人数 2 / 行动项 2 完成 of 3
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
    // creator.name 为 null → 邮箱；第二行无 creator 则不渲染
    expect(screen.getByText("creator@example.com")).toBeInTheDocument();
    expect(
      screen.getByText(
        `minutes:createdAt:${JSON.stringify({
          date: new Date("2026-11-01T10:00:00Z").toLocaleString(),
        })}`,
      ),
    ).toBeInTheDocument();
  });

  it("行链接指向详情页", async () => {
    defaultApi();
    render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Weekly sync")).toBeInTheDocument());

    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/w/ws-1/meeting-minutes/m-1");
    expect(links[1]).toHaveAttribute("href", "/w/ws-1/meeting-minutes/m-2");
  });

  it("新建：POST 空纪要后跳转详情", async () => {
    defaultApi();
    render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Retro")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "minutes:create" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));

    expect(mocks.push).toHaveBeenCalledWith("/w/ws-1/meeting-minutes/m-9");
    const post = mocks.api.mock.calls.find(([, o]) => o?.method === "POST");
    expect(post?.[0]).toBe(LIST_PATH);
    expect(bodyOf(post ?? [])).toEqual({
      title: "minutes:untitled",
      content: "",
      attendees: [],
      actionItems: [],
    });
  });

  it("新建失败：显示错误、按钮恢复且不跳转", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") throw new mocks.ApiErrorClass("create-boom");
      return { items };
    });
    render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Retro")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "minutes:create" }));
    await waitFor(() => expect(screen.getByText("create-boom")).toBeInTheDocument());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "minutes:create" })).toBeEnabled();
  });

  it("删除：确认后 DELETE 并本地移除", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Weekly sync")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("minutes:delete")[0]);
    await waitFor(() => expect(screen.queryByText("Weekly sync")).not.toBeInTheDocument());

    expect(mocks.api).toHaveBeenCalledWith(`${LIST_PATH}/m-1`, { method: "DELETE" });
    expect(screen.getByText("Retro")).toBeInTheDocument();
  });

  it("删除取消：不发请求", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Weekly sync")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("minutes:delete")[0]);
    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "DELETE")).toHaveLength(0),
    );
    expect(screen.getByText("Weekly sync")).toBeInTheDocument();
  });

  it("删除失败：ApiError 原文；非 ApiError 回退 deleteFailed", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") throw new mocks.ApiErrorClass("delete-boom");
      return { items };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const first = render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Weekly sync")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("minutes:delete")[0]);
    await waitFor(() => expect(screen.getByText("delete-boom")).toBeInTheDocument());
    expect(screen.getByText("Weekly sync")).toBeInTheDocument();
    first.unmount();

    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") throw { weird: true };
      return { items };
    });
    render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Weekly sync")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("minutes:delete")[0]);
    await waitFor(() => expect(screen.getByText("minutes:deleteFailed")).toBeInTheDocument());
  });

  it("空列表显示空态", async () => {
    defaultApi([]);
    render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("minutes:noMinutes")).toBeInTheDocument());
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("加载失败：Error 显示消息，非 Error 回退 loadFailed", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("list-boom");
    });
    const first = render(<MinutesList wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("list-boom")).toBeInTheDocument());
    first.unmount();

    mocks.api.mockImplementation(async () => {
      throw "nope";
    });
    render(<MinutesList wid="ws-1" />);
    // 回退文案是 loadFailed，空态文案是 noMinutes（两者不同，只出现一次）
    await waitFor(() => expect(screen.getByText("minutes:loadFailed")).toBeInTheDocument());
    expect(screen.getByText("minutes:noMinutes")).toBeInTheDocument();
  });
});
