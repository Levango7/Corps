// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { ApprovalDetail } from "@/components/approval/ApprovalDetail";

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

const NODES = [
  { name: "HR", order: 1 },
  { name: "Manager", order: 2, approverRole: "admin" },
];

/** 默认操作记录（提交在后、approve 在前，用于验证倒序展示） */
const OPS = [
  {
    id: "op-1",
    action: "submit",
    operatorId: "u-app",
    operator: { id: "u-app", name: "Alice", email: "alice@example.com" },
    nodeName: "Start",
    comment: "initial submit",
    createdAt: "2026-10-15T08:30:00Z",
  },
  {
    id: "op-2",
    action: "approve",
    operatorId: "me-1",
    operator: { id: "me-1", name: "Erin", email: "erin@example.com" },
    nodeName: "HR",
    comment: "looks good",
    createdAt: "2026-10-15T09:00:00Z",
  },
];

function mkDetail(over: Record<string, unknown> = {}) {
  return {
    id: "a-1",
    title: "Quarterly budget",
    description: "Please review the numbers",
    status: "pending",
    applicantId: "u-app",
    applicant: { id: "u-app", name: "Alice", email: "alice@example.com" },
    templateName: "BudgetApproval",
    content: { amount: "100", meta: { tier: "gold" } },
    nodes: NODES,
    currentNode: 1,
    submittedAt: "2026-10-15T08:30:00Z",
    currentApproverIds: ["me-1"],
    operations: OPS,
    ...over,
  };
}

const CC_USERS = [
  {
    id: "cc-1",
    userId: "u-2",
    user: { id: "u-2", name: "Bob", email: "bob@example.com" },
    nodeName: "Manager",
    read: true,
  },
  { id: "cc-2", userId: "u-3", userName: "Carol", nodeName: "HR", read: false },
];

function mockApi(opts: {
  getDetail: () => unknown;
  me?: unknown;
  cc?: unknown[];
  onPost?: (url: string, body?: string) => void;
  rejectDetail?: unknown;
  rejectMe?: unknown;
  rejectPost?: unknown;
}) {
  apiMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.includes("/users/me")) {
      if (opts.rejectMe) throw opts.rejectMe;
      return opts.me ?? { id: "me-1" };
    }
    if (url.includes("/cc")) return opts.cc ?? [];
    if (init?.method === "POST") {
      if (opts.rejectPost) throw opts.rejectPost;
      opts.onPost?.(url, init.body);
      return {};
    }
    if (url.includes("/approvals/instances/")) {
      if (opts.rejectDetail) throw opts.rejectDetail;
      return opts.getDetail();
    }
    throw new Error(`unexpected url: ${url}`);
  });
}

async function renderLoaded(
  opts: {
    detail?: unknown;
    me?: unknown;
    cc?: unknown[];
    onPost?: (url: string, body?: string) => void;
    rejectDetail?: unknown;
    rejectMe?: unknown;
    rejectPost?: unknown;
  } = {},
) {
  let current: unknown = opts.detail ?? mkDetail();
  mockApi({
    getDetail: () => current,
    me: opts.me,
    cc: opts.cc,
    onPost: (url, body) => {
      opts.onPost?.(url, body);
      if (opts.onPost) current = opts.detail ?? current;
    },
    rejectDetail: opts.rejectDetail,
    rejectMe: opts.rejectMe,
    rejectPost: opts.rejectPost,
  });
  render(<ApprovalDetail approvalId="a-1" workspaceId="ws-1" />);
  await act(async () => {});
  return {
    /** 让 refetch 返回新对象，触发重渲染 */
    replaceDetail(next: unknown) {
      current = next;
    },
  };
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe("ApprovalDetail", () => {
  it("renders the loading state before data lands", () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    render(<ApprovalDetail approvalId="a-1" workspaceId="ws-1" />);
    expect(screen.getByText("approval:loading")).toBeInTheDocument();
  });

  it("renders the title, status badge, meta information and description", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { name: "Quarterly budget" })).toBeInTheDocument();
    expect(screen.getByText("approval:pending")).toBeInTheDocument();
    const dl = document.querySelector("dl")!;
    expect(within(dl).getByText("Alice")).toBeInTheDocument();
    expect(within(dl).getByText("approval:applicant")).toBeInTheDocument();
    expect(within(dl).getByText("approval:submittedAt")).toBeInTheDocument();
    expect(within(dl).getByText("BudgetApproval")).toBeInTheDocument();
    // 未完成时不渲染 completedAt
    expect(within(dl).queryByText("approval:completedAt")).not.toBeInTheDocument();
    expect(screen.getByText("Please review the numbers")).toBeInTheDocument();
  });

  it("links back to the approval list", async () => {
    await renderLoaded();
    expect(screen.getByRole("link", { name: /approval:back/ })).toHaveAttribute(
      "href",
      "/w/ws-1/approvals",
    );
  });

  it("renders content entries, stringifying object values", async () => {
    await renderLoaded();
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("meta")).toBeInTheDocument();
    expect(screen.getByText('{"tier":"gold"}')).toBeInTheDocument();
  });

  it("renders the flow diagram section with the instance nodes", async () => {
    await renderLoaded();
    const section = screen.getByText("approval:flowDiagram").closest("section")!;
    expect(within(section).getByText("HR")).toBeInTheDocument();
    expect(within(section).getByText("Manager")).toBeInTheDocument();
  });

  it("renders operations newest-first with labels, operators and comments", async () => {
    await renderLoaded();
    const section = screen.getByText("approval:operations").closest("section")!;
    const lis = [...section.querySelectorAll("ol li")];
    expect(lis).toHaveLength(2);
    // 倒序：最新（approve）在上
    expect(lis[0].textContent).toContain("approval:operationApprove");
    expect(lis[0].textContent).toContain("Erin");
    expect(lis[0].textContent).toContain("looks good");
    expect(lis[0].textContent).toContain("HR");
    expect(lis[1].textContent).toContain("approval:operationSubmit");
    expect(lis[1].textContent).toContain("Alice");
    expect(lis[1].textContent).toContain("initial submit");
  });

  it("falls back through operator email and legacy flat fields", async () => {
    await renderLoaded({
      detail: mkDetail({
        operations: [
          {
            id: "op-a",
            action: "approve",
            operatorId: "u-2",
            operator: { id: "u-2", name: null, email: "erin@example.com" },
            createdAt: "2026-10-15T09:00:00Z",
          },
          {
            id: "op-b",
            action: "approve",
            operatorId: "u-3",
            operator: null,
            operatorName: "Dan",
            createdAt: "2026-10-15T09:10:00Z",
          },
          {
            id: "op-c",
            action: "approve",
            operatorId: "u-4",
            operator: null,
            createdAt: "2026-10-15T09:20:00Z",
          },
        ],
      }),
    });
    expect(screen.getByText("erin@example.com")).toBeInTheDocument();
    expect(screen.getByText("Dan")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows an empty state when there are no operations", async () => {
    await renderLoaded({ detail: mkDetail({ operations: [] }) });
    expect(screen.getByText("approval:noOperations")).toBeInTheDocument();
  });

  it("renders cc users with their read state and hides the section when empty", async () => {
    await renderLoaded({ cc: CC_USERS });
    expect(screen.getByText("approval:ccUsers")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("Unread")).toBeInTheDocument();
    cleanup();
    await renderLoaded({ cc: [] });
    expect(screen.queryByText("approval:ccUsers")).not.toBeInTheDocument();
  });

  it("surfaces the ApiError message and the i18n fallback for other rejections", async () => {
    await renderLoaded({ rejectDetail: new ApiErrorMock("boom-detail") });
    expect(screen.getByText("boom-detail")).toBeInTheDocument();
    cleanup();
    await renderLoaded({ rejectDetail: "nope" });
    expect(screen.getByText("approval:loadFailed")).toBeInTheDocument();
  });

  it("hides all action buttons when the current user cannot be resolved", async () => {
    await renderLoaded({ rejectMe: new Error("me-down") });
    expect(screen.queryByRole("button", { name: "approval:approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "approval:withdraw" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
  });

  it("shows approver-only actions for the current approver but not withdraw", async () => {
    // me-1 在 currentApproverIds 中且状态为 pending
    await renderLoaded();
    expect(screen.getByRole("button", { name: "approval:approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "approval:reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "approval:transfer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "approval:addSign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "approval:delegate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
    // 申请人不是当前用户，不能撤回
    expect(screen.queryByRole("button", { name: "approval:withdraw" })).not.toBeInTheDocument();
  });

  it("shows withdraw and comment for the applicant while pending", async () => {
    await renderLoaded({ detail: mkDetail({ applicantId: "me-1", currentApproverIds: [] }) });
    expect(screen.getByRole("button", { name: "approval:withdraw" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "approval:approve" })).not.toBeInTheDocument();
  });

  it("shows no action buttons for an uninvolved user", async () => {
    await renderLoaded({ detail: mkDetail({ currentApproverIds: [] }) });
    expect(screen.queryByRole("button", { name: "approval:approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "approval:withdraw" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
  });

  it("forbids withdrawing an already approved instance", async () => {
    await renderLoaded({
      detail: mkDetail({ applicantId: "me-1", status: "approved", currentApproverIds: [] }),
    });
    expect(screen.queryByRole("button", { name: "approval:withdraw" })).not.toBeInTheDocument();
    expect(screen.getByText("approval:approved")).toBeInTheDocument();
  });

  it("approves without a comment, refetches the detail and closes the dialog", async () => {
    const handle = await renderLoaded();
    handle.replaceDetail(mkDetail({ status: "approved" }));
    fireEvent.click(screen.getByRole("button", { name: "approval:approve" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("approval:confirmApprove");
    fireEvent.click(screen.getByRole("button", { name: "button:confirm" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/approvals/instances/a-1/approve",
      { method: "POST", body: undefined },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 重拉详情后徽标变为 approved
    expect(screen.getByText("approval:approved")).toBeInTheDocument();
  });

  it("approves with a comment and sends it as the request body", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:approve" }));
    fireEvent.change(screen.getByLabelText("approval:comment"), { target: { value: "ok" } });
    fireEvent.click(screen.getByRole("button", { name: "button:confirm" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/approvals/instances/a-1/approve",
      { method: "POST", body: JSON.stringify({ comment: "ok" }) },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a non-empty comment before posting the comment action", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("approval:confirmComment");
    fireEvent.click(screen.getByRole("button", { name: "button:confirm" }));
    expect(screen.getByText("approval:commentRequired")).toBeInTheDocument();
    // 补上正文后可提交
    fireEvent.change(screen.getByLabelText("approval:comment"), { target: { value: "a note" } });
    fireEvent.click(screen.getByRole("button", { name: "button:confirm" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/approvals/instances/a-1/comment",
      { method: "POST", body: JSON.stringify({ comment: "a note" }) },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a target user for transfer, then posts the mapped id field", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:transfer" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("approval:confirmTransfer");
    fireEvent.click(screen.getByRole("button", { name: "button:confirm" }));
    expect(screen.getByText("approval:selectUser")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("approval:selectUser"), {
      target: { value: "u-9" },
    });
    fireEvent.change(screen.getByLabelText("approval:comment"), { target: { value: "handoff" } });
    fireEvent.click(screen.getByRole("button", { name: "button:confirm" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/approvals/instances/a-1/transfer",
      { method: "POST", body: JSON.stringify({ transferToId: "u-9", comment: "handoff" }) },
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the action dialog open with the failure message on a rejected action", async () => {
    await renderLoaded({ rejectPost: new ApiErrorMock("boom-op") });
    fireEvent.click(screen.getByRole("button", { name: "approval:approve" }));
    fireEvent.click(screen.getByRole("button", { name: "button:confirm" }));
    await act(async () => {});
    expect(screen.getByText("boom-op")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("dismisses the action dialog on ESC and backdrop click, keeping inner clicks open", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:approve" }));
    // 弹窗根元素同时是遮罩层：先点内部面板，不应关闭
    const panel = document.querySelector('div[role="dialog"] > div')!;
    fireEvent.click(panel);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // ESC 关闭
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 再次打开后点击遮罩层自身（target === currentTarget）关闭
    fireEvent.click(screen.getByRole("button", { name: "approval:approve" }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
