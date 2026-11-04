// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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
  return { api: vi.fn(), ApiErrorClass: ApiError };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));

import ActivityWidget from "@/components/widgets/ActivityWidget";

const PATH = "/api/v1/workspaces/ws-1/activity";

function secondsAgo(n: number): string {
  return new Date(Date.now() - n * 1000).toISOString();
}
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

const items = [
  {
    id: "a-1",
    type: "task.created",
    actorId: "u-1",
    actorName: "Alice",
    entityType: "task",
    entityId: "t-1",
    entityTitle: "Fix login",
    createdAt: minutesAgo(5),
  },
  {
    id: "a-2",
    type: "task.updated",
    actorId: null,
    actorName: null,
    entityType: "task",
    entityId: "t-2",
    entityTitle: "Ship docs",
    createdAt: minutesAgo(30),
  },
  {
    id: "a-3",
    type: "comment.created",
    actorId: "u-3",
    actorName: "carol",
    entityType: "comment",
    entityId: "c-1",
    entityTitle: "Nice work",
    createdAt: secondsAgo(10),
  },
  {
    id: "a-4",
    type: "decision.created",
    actorId: "u-4",
    actorName: "Dave",
    entityType: "decision",
    entityId: "d-1",
    entityTitle: "Use Postgres",
    createdAt: daysAgo(3),
  },
  {
    id: "a-5",
    type: "decision.updated",
    actorId: "u-5",
    actorName: "Erin",
    entityType: "decision",
    entityId: "d-2",
    entityTitle: "Use Postgres v2",
    createdAt: daysAgo(40),
  },
  {
    id: "a-6",
    type: "task.created",
    actorId: "u-6",
    actorName: "Frank",
    entityType: "task",
    entityId: "t-6",
    entityTitle: "Sixth item",
    createdAt: daysAgo(2),
  },
];

function defaultApi() {
  mocks.api.mockImplementation(async () => ({ items, nextCursor: null }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ActivityWidget", () => {
  it("加载中渲染骨架屏：aria-busy + 4 条占位", () => {
    defaultApi();
    const { container } = render(<ActivityWidget wid="ws-1" />);
    expect(screen.getByLabelText("activity:loading")).toHaveAttribute("aria-busy", "true");
    // 4 行骨架，每行 2 个占位块（头像圆 + 文本条）
    expect(container.querySelectorAll("span.animate-pulse")).toHaveLength(8);
  });

  it("请求活动流接口并最多渲染 5 条（默认 limit）", async () => {
    defaultApi();
    const { container } = render(<ActivityWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(5));

    expect(mocks.api).toHaveBeenCalledWith(PATH);
    expect(screen.getByRole("feed", { name: "activity:title" })).toBeInTheDocument();
    expect(screen.queryByText("Sixth item")).not.toBeInTheDocument();
    expect(container.querySelectorAll("time")).toHaveLength(5);
  });

  it("每条活动渲染头像首字母、动作文案、实体标题与相对时间", async () => {
    defaultApi();
    const { container } = render(<ActivityWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(5));

    // 首字母头像：有名字取大写首字母，无名字用 ?
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
    // 无 actorName 时回退 unknownUser 文案
    expect(screen.getByText("activity:unknownUser")).toBeInTheDocument();

    // 五种活动类型的动作文案
    expect(screen.getByText("activity:taskCreated")).toBeInTheDocument();
    expect(screen.getByText("activity:taskUpdated")).toBeInTheDocument();
    expect(screen.getByText("activity:commentCreated")).toBeInTheDocument();
    expect(screen.getByText("activity:decisionCreated")).toBeInTheDocument();
    expect(screen.getByText("activity:decisionUpdated")).toBeInTheDocument();

    // 实体标题
    expect(screen.getByText("Fix login")).toBeInTheDocument();
    expect(screen.getByText("Use Postgres")).toBeInTheDocument();

    // 相对时间四档：刚发生 / 分钟 / 天 / ≥30 天走 zh-CN 日期
    expect(screen.getByText("time:justNow")).toBeInTheDocument();
    expect(screen.getByText('time:minutesAgo:{"count":5}')).toBeInTheDocument();
    expect(screen.getByText('time:minutesAgo:{"count":30}')).toBeInTheDocument();
    expect(screen.getByText('time:daysAgo:{"count":3}')).toBeInTheDocument();
    expect(
      screen.getByText(
        new Date(items[4].createdAt).toLocaleDateString("zh-CN", {
          month: "numeric",
          day: "numeric",
        }),
      ),
    ).toBeInTheDocument();

    // time 元素带机器可读的 dateTime
    expect(container.querySelector("time")).toHaveAttribute("dateTime", items[0].createdAt);
  });

  it("limit 属性限制渲染条数", async () => {
    defaultApi();
    render(<ActivityWidget wid="ws-1" limit={2} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getByText("Fix login")).toBeInTheDocument();
    expect(screen.queryByText("Nice work")).not.toBeInTheDocument();
  });

  it("空数据渲染空态", async () => {
    mocks.api.mockImplementation(async () => ({ items: [], nextCursor: null }));
    render(<ActivityWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("activity:empty")).toBeInTheDocument());
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
  });

  it("加载失败渲染错误态而非列表", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("activity down");
    });
    render(<ActivityWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("activity:loadFailed")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
  });

  it("切换工作区后按新 wid 重新拉取", async () => {
    defaultApi();
    const { rerender } = render(<ActivityWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(5));

    rerender(<ActivityWidget wid="ws-2" />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-2/activity"));
  });
});
