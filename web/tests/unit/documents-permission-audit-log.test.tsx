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

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), ApiErrorClass: ApiError };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));

import { PermissionAuditLogPage } from "@/components/documents/PermissionAuditLogPage";

const BASE_PATH = "/api/v1/workspaces/ws-1/permissions/audit-logs";

const entries = [
  {
    id: "log-1",
    action: "grant",
    targetType: "document",
    targetId: "doc-1",
    granteeType: "user",
    granteeId: "u-2",
    oldPermission: null,
    newPermission: "manage",
    operatorId: "op-1",
    operator: { id: "op-1", name: "Alice", email: null },
    reason: "initial grant",
    createdAt: "2026-10-01T09:30:00Z",
  },
  {
    id: "log-2",
    action: "revoke",
    targetType: "folder",
    targetId: "f-1",
    granteeType: "role",
    granteeId: "r-1",
    oldPermission: "view",
    newPermission: null,
    operatorId: "op-2",
    operator: { id: "op-2", name: null, email: "op2@example.com" },
    reason: null,
    createdAt: "2026-10-02T10:00:00Z",
  },
  {
    id: "log-3",
    action: "update",
    targetType: "space",
    targetId: "s-1",
    granteeType: "user",
    granteeId: "u-3",
    oldPermission: "owner",
    newPermission: "edit",
    operatorId: "op-3",
    operator: null,
    reason: "policy change",
    createdAt: "2026-10-03T11:00:00Z",
  },
];

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    items: entries,
    total: entries.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    ...overrides,
  };
}

function defaultApi() {
  mocks.api.mockImplementation(async () => envelope());
}

function paramsOf(call: unknown[]): URLSearchParams {
  const url = call[0] as string;
  return new URLSearchParams(url.slice(url.indexOf("?") + 1));
}

function paramsOfLast(): URLSearchParams {
  const calls = mocks.api.mock.calls;
  return paramsOf(calls[calls.length - 1]);
}

function renderPage() {
  return render(<PermissionAuditLogPage workspaceId="ws-1" />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PermissionAuditLogPage", () => {
  it("初次加载携带 page=1 与 pageSize=20", async () => {
    defaultApi();
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    // 每行内操作标签双现：独立文案 + 徽章
    expect(
      within(screen.getAllByRole("listitem")[0]).getAllByText("permissions:actionGrant"),
    ).toHaveLength(2);

    expect(mocks.api.mock.calls[0][0]).toContain(`${BASE_PATH}?`);
    const params = paramsOf(mocks.api.mock.calls[0]);
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("20");
    expect(params.get("targetType")).toBeNull();
    expect(params.get("action")).toBeNull();
  });

  it("加载中标题与加载文案并存", () => {
    defaultApi();
    renderPage();
    expect(screen.getAllByText("permissions:auditLogs")).toHaveLength(2);
  });

  it("完整渲染 grant 条目：操作标签双现、详情与本地化时间", async () => {
    defaultApi();
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const row = screen.getAllByRole("listitem")[0];

    expect(within(row).getAllByText("permissions:actionGrant")).toHaveLength(2);
    expect(
      within(row).getByText("permissions:targetType: permissions:document"),
    ).toBeInTheDocument();
    expect(within(row).getByText("ID: doc-1")).toBeInTheDocument();
    expect(within(row).getByText("permissions:granteeType: permissions:user")).toBeInTheDocument();
    expect(within(row).getByText("u-2")).toBeInTheDocument();
    expect(
      within(row).getByText("permissions:newPermission: permissions:manage"),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/permissions:oldPermission/)).not.toBeInTheDocument();
    expect(within(row).getByText("permissions:operator: Alice")).toBeInTheDocument();
    expect(within(row).getByText("permissions:reason: initial grant")).toBeInTheDocument();
    expect(
      within(row).getByText(new Date("2026-10-01T09:30:00Z").toLocaleString()),
    ).toBeInTheDocument();
  });

  it("revoke/update 条目：操作人回退链与非法级别省略", async () => {
    defaultApi();
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const rows = screen.getAllByRole("listitem");

    expect(within(rows[1]).getAllByText("permissions:actionRevoke")).toHaveLength(2);
    expect(within(rows[2]).getAllByText("permissions:actionUpdate")).toHaveLength(2);
    // operator.name 为空回退 email
    expect(within(rows[1]).getByText("permissions:operator: op2@example.com")).toBeInTheDocument();
    expect(
      within(rows[1]).getByText("permissions:oldPermission: permissions:view"),
    ).toBeInTheDocument();
    // operator 整体缺失回退 operatorId
    expect(within(rows[2]).getByText("permissions:operator: op-3")).toBeInTheDocument();
    expect(
      within(rows[2]).getByText("permissions:newPermission: permissions:edit"),
    ).toBeInTheDocument();
    // 非法级别 "owner" 不渲染原权限标签
    expect(within(rows[2]).queryByText(/permissions:oldPermission/)).not.toBeInTheDocument();
    expect(within(rows[2]).getByText("permissions:reason: policy change")).toBeInTheDocument();
  });

  it("操作人字段全空时回退为破折号", async () => {
    mocks.api.mockImplementation(async () =>
      envelope({
        items: [
          {
            id: "log-x",
            action: "grant",
            targetType: "document",
            targetId: "doc-9",
            granteeType: "user",
            granteeId: "u-9",
            oldPermission: null,
            newPermission: "view",
            operatorId: "",
            operator: null,
            reason: null,
            createdAt: "2026-10-04T11:00:00Z",
          },
        ],
        total: 1,
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("permissions:operator: —")).toBeInTheDocument());
  });

  it("兼容裸数组响应且单页不渲染分页", async () => {
    mocks.api.mockImplementation(async () => entries);
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.queryByLabelText("previous page")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("next page")).not.toBeInTheDocument();
  });

  it("空列表显示空态", async () => {
    mocks.api.mockImplementation(async () => envelope({ items: [], total: 0 }));
    renderPage();
    await waitFor(() => expect(screen.getByText("permissions:noAuditLogs")).toBeInTheDocument());
  });

  it("ApiError 消息直显，非错误对象回退空态文案", async () => {
    mocks.api.mockImplementation(async () => {
      throw new mocks.ApiErrorClass("audit-boom");
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("audit-boom")).toBeInTheDocument());
  });

  it("非 Error 抛出时回退到 noAuditLogs 文案", async () => {
    mocks.api.mockImplementation(async () => {
      throw "nope";
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByText("permissions:noAuditLogs")).toHaveLength(2));
  });

  it("修改筛选立即触发重拉并带对应参数", async () => {
    defaultApi();
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));

    fireEvent.change(screen.getByLabelText("permissions:targetType"), {
      target: { value: "document" },
    });
    await waitFor(() => expect(paramsOfLast().get("targetType")).toBe("document"));

    fireEvent.change(screen.getByLabelText("permissions:action"), { target: { value: "grant" } });
    await waitFor(() => expect(paramsOfLast().get("action")).toBe("grant"));

    fireEvent.change(screen.getByLabelText("start date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("end date"), { target: { value: "2026-10-31" } });
    await waitFor(() => expect(paramsOfLast().get("startDate")).toBe("2026-10-01"));
    expect(paramsOfLast().get("endDate")).toBe("2026-10-31");
  });

  it("应用筛选回到第一页并保留全部条件", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));
      return envelope({ page: Number(params.get("page")), total: 25, totalPages: 2 });
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("next page"));
    await waitFor(() => expect(paramsOfLast().get("page")).toBe("2"));

    fireEvent.change(screen.getByLabelText("permissions:targetType"), {
      target: { value: "document" },
    });
    await waitFor(() => expect(paramsOfLast().get("targetType")).toBe("document"));

    fireEvent.click(screen.getByRole("button", { name: "permissions:action" }));
    await waitFor(() => expect(paramsOfLast().get("page")).toBe("1"));
    expect(paramsOfLast().get("targetType")).toBe("document");
    expect(paramsOfLast().get("pageSize")).toBe("20");
  });

  it("分页按钮边界禁用与计数行", async () => {
    mocks.api.mockImplementation(async () => envelope({ total: 25, totalPages: 2 }));
    renderPage();
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());

    expect(screen.getByText("25 permissions:auditLogs")).toBeInTheDocument();
    expect(screen.getByLabelText("previous page")).toBeDisabled();
    expect(screen.getByLabelText("next page")).toBeEnabled();

    fireEvent.click(screen.getByLabelText("next page"));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    expect(screen.getByLabelText("previous page")).toBeEnabled();
    expect(screen.getByLabelText("next page")).toBeDisabled();

    fireEvent.click(screen.getByLabelText("previous page"));
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());
    expect(paramsOfLast().get("page")).toBe("1");
  });

  it("重置按钮仅在筛选非默认时出现并清空全部条件", async () => {
    defaultApi();
    renderPage();
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "permissions:close" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("permissions:action"), { target: { value: "revoke" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "permissions:close" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "permissions:close" }));
    await waitFor(() => expect(paramsOfLast().get("action")).toBeNull());
    const params = paramsOfLast();
    expect(params.get("targetType")).toBeNull();
    expect(params.get("startDate")).toBeNull();
    expect(params.get("endDate")).toBeNull();
    expect(params.get("page")).toBe("1");
    expect(screen.queryByRole("button", { name: "permissions:close" })).not.toBeInTheDocument();
  });
});
