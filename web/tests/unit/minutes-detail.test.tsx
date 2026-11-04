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
vi.mock("@/lib/i18n-navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import { MinutesDetail } from "@/components/minutes/MinutesDetail";

const data = {
  id: "m-1",
  title: "Weekly sync",
  content: "# Agenda\n\nplain line\n**bold bit**\n## Section\n### Sub\ntail",
  attendees: [{ name: "Alice", role: "host" }, { name: "Bob" }],
  actionItems: [
    { title: "Ship it", assigneeId: "u-2", dueDate: "2026-11-20T00:00:00Z", done: true },
    { title: "Follow up", done: false },
  ],
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-02T11:00:00Z",
  // 显式放宽为可空，便于 overrides 传 null 走「无创建人」分支
  creator: { id: "u-1", name: null, email: "creator@example.com" } as {
    id: string;
    name: string | null;
    email: string;
  } | null,
};

function renderDetail(overrides: Partial<typeof data> = {}) {
  const utils = render(<MinutesDetail wid="ws-1" mid="m-1" data={{ ...data, ...overrides }} />);
  return utils;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.push.mockClear();
});

describe("MinutesDetail", () => {
  it("头部：标题、创建人回退邮箱、创建与更新时间", () => {
    renderDetail();

    expect(screen.getByText("Weekly sync")).toBeInTheDocument();
    expect(
      screen.getByText(`minutes:createdBy:${JSON.stringify({ name: "creator@example.com" })}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `minutes:createdAt:${JSON.stringify({
          date: new Date(data.createdAt).toLocaleString(),
        })}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `minutes:updatedAt:${JSON.stringify({
          date: new Date(data.updatedAt).toLocaleString(),
        })}`,
      ),
    ).toBeInTheDocument();
  });

  it("无创建人时不渲染创建人那一行", () => {
    renderDetail({ creator: null });
    expect(screen.queryByText(/minutes:createdBy/)).not.toBeInTheDocument();
  });

  it("Markdown 渲染：# / ## / ### 标题与 **加粗**、空行间隔、普通段落", () => {
    renderDetail();

    const h1 = screen.getByRole("heading", { level: 1, name: "Agenda" });
    expect(h1).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Sub" })).toBeInTheDocument();

    // 加粗片段渲染成 strong
    const strong = screen.getByText("bold bit");
    expect(strong.tagName).toBe("STRONG");
    // 普通段落
    expect(screen.getByText("plain line")).toBeInTheDocument();
    expect(screen.getByText("tail")).toBeInTheDocument();
  });

  it("内容为空时显示占位", () => {
    renderDetail({ content: "   " });
    expect(screen.getByText("minutes:contentEmpty")).toBeInTheDocument();
  });

  it("参会人员：计数、姓名与角色，缺失时报空态", () => {
    const first = renderDetail();
    expect(screen.getByText(/minutes:attendees/)).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("· host")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    first.unmount();

    renderDetail({ attendees: [] });
    expect(screen.getByText("minutes:noAttendees")).toBeInTheDocument();
    expect(screen.getByText("(0)")).toBeInTheDocument();
  });

  it("行动项：完成比、勾选态、负责人与截止日期，缺失时报空态", () => {
    const first = renderDetail();
    // 标题里 (1/2)
    expect(screen.getByText("(1/2)")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(screen.getByText("u-2")).toBeInTheDocument();
    expect(
      screen.getByText(new Date("2026-11-20T00:00:00Z").toLocaleDateString()),
    ).toBeInTheDocument();
    // 完成的项加删除线样式
    expect(screen.getByText("Ship it").className).toContain("line-through");
    expect(screen.getByText("Follow up").className).not.toContain("line-through");
    // 完成态标记：两枚 aria-label 容器，只有完成的那枚内含 svg
    const marks = screen.getAllByLabelText("minutes:actionDone");
    expect(marks).toHaveLength(2);
    expect(marks[0].querySelector("svg")).not.toBeNull();
    expect(marks[1].querySelector("svg")).toBeNull();
    first.unmount();

    renderDetail({ actionItems: [] });
    expect(screen.getByText("minutes:noActions")).toBeInTheDocument();
    expect(screen.getByText("(0/0)")).toBeInTheDocument();
  });

  it("编辑按钮跳转到带 edit=1 的详情地址", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "minutes:edit" }));
    expect(mocks.push).toHaveBeenCalledWith("/w/ws-1/meeting-minutes/m-1?edit=1");
  });

  it("删除：确认后 DELETE 并跳回列表", async () => {
    mocks.api.mockImplementation(async () => ({}));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "minutes:delete" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/meeting-minutes/m-1", {
      method: "DELETE",
    });
    expect(mocks.push).toHaveBeenCalledWith("/w/ws-1/meeting-minutes");
  });

  it("删除取消：不发请求也不跳转", async () => {
    mocks.api.mockImplementation(async () => ({}));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "minutes:delete" }));
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("删除失败：ApiError 原文并恢复按钮", async () => {
    mocks.api.mockImplementation(async () => {
      throw new mocks.ApiErrorClass("delete-boom");
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "minutes:delete" }));
    await waitFor(() => expect(screen.getByText("delete-boom")).toBeInTheDocument());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "minutes:delete" })).toBeEnabled();
  });

  it("删除失败：非 ApiError 回退 deleteFailed", async () => {
    mocks.api.mockImplementation(async () => {
      throw { weird: true };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "minutes:delete" }));
    await waitFor(() => expect(screen.getByText("minutes:deleteFailed")).toBeInTheDocument());
  });
});
