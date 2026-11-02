// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ApprovalList, type ApprovalInstanceListItem } from "@/components/approval/ApprovalList";

const { apiMock, ApiErrorMock } = vi.hoisted(() => {
  class ApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { apiMock: vi.fn(), ApiErrorMock: ApiError };
});

vi.mock("@/lib/api", () => ({ api: apiMock, ApiError: ApiErrorMock }));

vi.mock("@/lib/i18n-navigation", async () => {
  const React = await import("react");
  type LinkProps = { href: string; className?: string; children?: React.ReactNode };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>((props, ref) =>
    React.createElement("a", { href: props.href, className: props.className, ref }, props.children),
  );
  Link.displayName = "MockLink";
  return { Link };
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

function mkItem(over: Partial<ApprovalInstanceListItem> = {}): ApprovalInstanceListItem {
  return {
    id: "a-1",
    title: "Quarterly budget",
    status: "pending",
    applicantId: "u-1",
    applicant: { id: "u-1", name: "Alice", email: "alice@example.com" },
    templateName: "BudgetApproval",
    submittedAt: "2026-10-15T08:30:00Z",
    ...over,
  };
}

/** 按URL前缀路由：instances 信封 / instances 裸数组 / cc 信封 / cc 裸数组 */
function mockRoutes(routes: { match: string; data: unknown }[]) {
  apiMock.mockImplementation(async (url: string) => {
    for (const r of routes) {
      if (url.includes(r.match)) return r.data;
    }
    throw new Error(`unexpected url: ${url}`);
  });
}

function renderList() {
  return render(<ApprovalList workspaceId="ws-1" />);
}

async function renderLoaded(routes: { match: string; data: unknown }[]) {
  mockRoutes(routes);
  const view = renderList();
  await act(async () => {});
  return view;
}

const INSTANCES = "/approvals/instances";
const CC = "/approvals/cc";

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe("ApprovalList", () => {
  it("fetches pending instances by default with page, limit and status=pending", async () => {
    apiMock.mockResolvedValue({ items: [], total: 0, totalPages: 1 });
    renderList();
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith(
      expect.stringContaining("/approvals/instances?page=1&limit=20&status=pending"),
    );
    expect(screen.queryByText("approval:loading")).not.toBeInTheDocument();
  });

  it("renders envelope items with status badges, applicant and template name", async () => {
    await renderLoaded([
      {
        match: INSTANCES,
        data: {
          items: [
            mkItem(),
            mkItem({ id: "a-2", title: "Leave request", status: "approved" }),
            mkItem({ id: "a-3", title: "Expense claim", status: "rejected" }),
            mkItem({ id: "a-4", title: "Travel desk", status: "withdrawn" }),
          ],
          total: 4,
          totalPages: 1,
        },
      },
    ]);
    expect(screen.getByText("Quarterly budget")).toBeInTheDocument();
    // 四种状态徽标各一（图标随状态变化）；pending 徽标与同名标签页按钮重名，按 span 定位
    const badgeOf = (label: string) =>
      screen.getAllByText(label).find((el) => el.tagName === "SPAN")!;
    expect(badgeOf("approval:pending").querySelector("svg.lucide-clock")).toBeTruthy();
    expect(badgeOf("approval:approved").querySelector("svg.lucide-check-circle-2")).toBeTruthy();
    expect(badgeOf("approval:rejected").querySelector("svg.lucide-x-circle")).toBeTruthy();
    expect(badgeOf("approval:withdrawn").querySelector("svg.lucide-minus-circle")).toBeTruthy();
    // 申请人 + 模板名（四条记录同申请人同模板，按计数断言）
    expect(screen.getAllByText(/approval:applicant: Alice/).length).toBe(4);
    expect(screen.getAllByText("BudgetApproval").length).toBe(4);
    // 条目链接指向详情页
    expect(screen.getByRole("link", { name: /Quarterly budget/ })).toHaveAttribute(
      "href",
      "/w/ws-1/approvals/a-1",
    );
  });

  it("falls back through applicant email and legacy flat fields before the dash", async () => {
    await renderLoaded([
      {
        match: INSTANCES,
        data: {
          items: [
            mkItem({
              id: "i-email",
              applicant: { id: "u-2", name: null, email: "bob@example.com" },
            }),
            mkItem({
              id: "i-legacy",
              applicant: null,
              applicantName: "Carol",
              applicantEmail: "carol@example.com",
            }),
            mkItem({
              id: "i-legacy-email",
              applicant: null,
              applicantName: null,
              applicantEmail: "dan@example.com",
            }),
            mkItem({ id: "i-none", applicant: null }),
          ],
          total: 4,
          totalPages: 1,
        },
      },
    ]);
    expect(screen.getByText(/approval:applicant: bob@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/approval:applicant: Carol/)).toBeInTheDocument();
    expect(screen.getByText(/approval:applicant: dan@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/approval:applicant: —/)).toBeInTheDocument();
  });

  it("accepts a bare array response and treats it as a single page", async () => {
    await renderLoaded([
      { match: INSTANCES, data: [mkItem(), mkItem({ id: "a-2", title: "Leave request" })] },
    ]);
    expect(screen.getByText("Quarterly budget")).toBeInTheDocument();
    // 裸数组 ⇒ 共一页，不渲染分页控件
    expect(screen.queryByRole("button", { name: "approval:nextPage" })).not.toBeInTheDocument();
  });

  it("switches to mine (mine=1, no status) and then to all (neither param)", async () => {
    apiMock.mockResolvedValue({ items: [], total: 0, totalPages: 1 });
    renderList();
    await act(async () => {});
    fireEvent.click(screen.getByRole("tab", { name: "approval:mine" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(
      expect.stringMatching(/instances\?page=1&limit=20&mine=1/),
    );
    fireEvent.click(screen.getByRole("tab", { name: "approval:all" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(expect.stringMatching(/instances\?page=1&limit=20$/));
  });

  it("uses the dedicated cc endpoint and maps cc records from an envelope", async () => {
    await renderLoaded([
      {
        match: CC,
        data: {
          items: [
            {
              id: "cc-1",
              instanceId: "a-9",
              userId: "u-me",
              nodeIndex: 1,
              createdAt: "2026-10-16T09:00:00Z",
              instance: {
                id: "a-9",
                title: "Budget v2",
                status: "approved",
                applicant: { id: "u-2", name: "Erin", email: "erin@example.com" },
              },
            },
          ],
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "approval:ccTab" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/approvals/cc?page=1&limit=20"),
    );
    expect(screen.getByText("Budget v2")).toBeInTheDocument();
    expect(screen.getByText(/approval:applicant: Erin/)).toBeInTheDocument();
    // cc 记录以实例 id 作为跳转目标
    expect(screen.getByRole("link", { name: /Budget v2/ })).toHaveAttribute(
      "href",
      "/w/ws-1/approvals/a-9",
    );
  });

  it("accepts a bare array of cc records", async () => {
    apiMock.mockResolvedValue([]);
    renderList();
    await act(async () => {});
    fireEvent.click(screen.getByRole("tab", { name: "approval:ccTab" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/approvals/cc?page=1&limit=20"),
    );
    expect(screen.getByText("approval:noApprovals")).toBeInTheDocument();
  });

  it("shows the error message for ApiError and the i18n fallback otherwise", async () => {
    apiMock.mockRejectedValue(new Error("boom-list"));
    renderList();
    await act(async () => {});
    expect(screen.getByText("boom-list")).toBeInTheDocument();
  });

  it("shows the i18n load-failed copy for non-Error rejections", async () => {
    apiMock.mockRejectedValue("nope");
    renderList();
    await act(async () => {});
    expect(screen.getByText("approval:loadFailed")).toBeInTheDocument();
  });

  it("filters by priority on the client without refetching", async () => {
    await renderLoaded([
      {
        match: INSTANCES,
        data: {
          items: [
            mkItem({ id: "p-n", priority: "normal" }),
            mkItem({ id: "p-u", priority: "urgent", title: "Urgent report" }),
            mkItem({ id: "p-c", priority: "critical", title: "Critical incident" }),
          ],
          total: 3,
          totalPages: 1,
        },
      },
    ]);
    fireEvent.change(screen.getByLabelText("approval:priority"), { target: { value: "urgent" } });
    expect(screen.getByText("Urgent report")).toBeInTheDocument();
    expect(screen.queryByText("Quarterly budget")).not.toBeInTheDocument();
    // 前端过滤不触发新的请求
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("searches by title or applicant name, case-insensitively", async () => {
    await renderLoaded([
      {
        match: INSTANCES,
        data: {
          items: [
            mkItem({ id: "s-1", title: "Quarterly budget" }),
            mkItem({
              id: "s-2",
              title: "Other",
              applicant: { id: "u-3", name: "Zoe", email: "z@example.com" },
            }),
          ],
          total: 2,
          totalPages: 1,
        },
      },
    ]);
    const input = screen.getByPlaceholderText("approval:searchPlaceholder");
    fireEvent.change(input, { target: { value: "QUARTERLY" } });
    expect(screen.getByText("Quarterly budget")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "zoe" } });
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.queryByText("Quarterly budget")).not.toBeInTheDocument();
  });

  it("shows the empty state when filters remove every item", async () => {
    await renderLoaded([
      {
        match: INSTANCES,
        data: {
          items: [mkItem({ id: "e-1", priority: "normal" })],
          total: 1,
          totalPages: 1,
        },
      },
    ]);
    fireEvent.change(screen.getByLabelText("approval:priority"), { target: { value: "critical" } });
    expect(screen.getByText("approval:noApprovals")).toBeInTheDocument();
  });

  it("renders pagination controls and walks pages with the correct params", async () => {
    await renderLoaded([
      {
        match: INSTANCES,
        data: {
          items: [mkItem()],
          total: 45,
          totalPages: 3,
        },
      },
    ]);
    const prev = screen.getByRole("button", { name: "approval:prevPage" });
    const next = screen.getByRole("button", { name: "approval:nextPage" });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();
    expect(screen.getByText('approval:total:{"count":45}')).toBeInTheDocument();
    expect(screen.getByText('approval:page:{"page":1,"total":3}')).toBeInTheDocument();

    // 注意：加载态会卸载整个分页条，每次点击前须重新查询按钮，避免节点过期
    fireEvent.click(screen.getByRole("button", { name: "approval:nextPage" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(
      expect.stringContaining("instances?page=2&limit=20&status=pending"),
    );
    fireEvent.click(screen.getByRole("button", { name: "approval:nextPage" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(
      expect.stringContaining("instances?page=3&limit=20&status=pending"),
    );
    // 到末页后 next 禁用
    expect(screen.getByRole("button", { name: "approval:nextPage" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "approval:prevPage" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(
      expect.stringContaining("instances?page=2&limit=20&status=pending"),
    );
  });

  it("does not show pagination when there is only one page", async () => {
    await renderLoaded([
      { match: INSTANCES, data: { items: [mkItem()], total: 1, totalPages: 1 } },
    ]);
    expect(screen.queryByText(/approval:total/)).not.toBeInTheDocument();
  });

  it("resets to page 1 when switching tabs", async () => {
    apiMock.mockResolvedValue({ items: [mkItem()], total: 45, totalPages: 3 });
    renderList();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "approval:nextPage" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(expect.stringContaining("page=2"));
    fireEvent.click(screen.getByRole("tab", { name: "approval:all" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenLastCalledWith(expect.stringMatching(/instances\?page=1&limit=20$/));
  });

  it("does not refetch when the active tab is clicked again", async () => {
    apiMock.mockResolvedValue({ items: [], total: 0, totalPages: 1 });
    renderList();
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("tab", { name: "approval:pending" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("does not update state after unmount when the response lands later", async () => {
    let resolveList: (value: unknown) => void = () => {};
    apiMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    const { unmount } = renderList();
    unmount();
    await act(async () => {
      resolveList({ items: [mkItem()], total: 1, totalPages: 1 });
    });
  });
});
