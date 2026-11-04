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
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), ApiErrorClass: ApiError };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));

import { DocumentPermissionPanel } from "@/components/documents/DocumentPermissionPanel";

const LIST_PATH = "/api/v1/workspaces/ws-1/documents/doc-1/permissions";
const MEMBERS_PATH = "/api/v1/workspaces/ws-1/members";
const ROLES_PATH = "/api/v1/workspaces/ws-1/roles";

const members = [
  { id: "u-1", name: "Alice", email: "alice@example.com" },
  { id: "u-2", name: null, email: "bob@example.com" },
];

const roles = [{ id: "r-1", name: "Admin" }];

const permissions = [
  {
    id: "p-1",
    granteeType: "user",
    granteeId: "u-1",
    granteeName: "Alice",
    permissionLevel: "manage",
    source: "explicit",
    grantedBy: "u-root",
    grantedByName: "Root",
    expiresAt: "2099-12-31T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "p-2",
    granteeType: "role",
    granteeId: "r-1",
    granteeName: "Admin",
    permissionLevel: "view",
    source: "inherited",
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "p-3",
    granteeType: "user",
    granteeId: "u-3",
    granteeName: "Carol",
    permissionLevel: "comment",
    source: "author",
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "p-4",
    granteeType: "user",
    granteeId: "u-4",
    granteeName: "Dave",
    permissionLevel: "edit",
    source: "module",
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

function bodyOf(call: unknown[]): {
  granteeType?: string;
  granteeId?: string;
  permissionLevel?: string;
} {
  return JSON.parse((call[1] as { body: string }).body);
}

function defaultApi() {
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (opts?.method === "DELETE" || opts?.method === "POST") return {};
    if (path === MEMBERS_PATH) return members;
    if (path === ROLES_PATH) return roles;
    return { items: permissions, total: permissions.length };
  });
}

function listGetCalls() {
  return mocks.api.mock.calls.filter(
    ([p, o]) => p === LIST_PATH && (!o || !o.method || o.method === "GET"),
  );
}

function renderPanel() {
  return render(<DocumentPermissionPanel workspaceId="ws-1" documentId="doc-1" />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DocumentPermissionPanel", () => {
  it("挂载时并发拉取权限/成员/角色三个接口", async () => {
    defaultApi();
    renderPanel();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    const paths = mocks.api.mock.calls.map((c) => c[0] as string);
    expect(paths).toContain(LIST_PATH);
    expect(paths).toContain(MEMBERS_PATH);
    expect(paths).toContain(ROLES_PATH);
  });

  it("加载中标题与加载态文案同时出现", () => {
    defaultApi();
    renderPanel();
    expect(screen.getAllByText("permissions:title")).toHaveLength(2);
  });

  it("列表渲染来源徽章/权限级别/授权人/过期时间", async () => {
    defaultApi();
    renderPanel();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    expect(screen.getByText("permissions:sourceExplicit")).toBeInTheDocument();
    expect(screen.getByText("permissions:sourceInherited")).toBeInTheDocument();
    expect(screen.getByText("permissions:sourceAuthor")).toBeInTheDocument();
    expect(screen.getByText("permissions:sourceModule")).toBeInTheDocument();

    expect(screen.getByText("permissions:manage")).toBeInTheDocument();
    expect(screen.getByText("permissions:view")).toBeInTheDocument();
    expect(screen.getByText("permissions:comment")).toBeInTheDocument();
    expect(screen.getByText("permissions:edit")).toBeInTheDocument();

    expect(screen.getByText("permissions:grantedBy: Root")).toBeInTheDocument();

    const formatted = new Date("2099-12-31T00:00:00Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    expect(screen.getByText(`permissions:expiresAt: ${formatted}`)).toBeInTheDocument();
    expect(screen.getAllByText(/permissions:expiresAt: permissions:noExpiry/)).toHaveLength(3);

    expect(screen.getAllByLabelText("permissions:removePermission")).toHaveLength(1);
  });

  it("空列表显示空态", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === MEMBERS_PATH) return [];
      if (path === ROLES_PATH) return [];
      return { items: [], total: 0 };
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("permissions:noPermissions")).toBeInTheDocument());
  });

  it("ApiError 消息直显，非错误对象回退空态文案", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === MEMBERS_PATH) return members;
      if (path === ROLES_PATH) return roles;
      throw new mocks.ApiErrorClass("boom-list");
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("boom-list")).toBeInTheDocument());
  });

  it("非 Error 抛出时回退到 noPermissions 文案", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === MEMBERS_PATH) return members;
      if (path === ROLES_PATH) return roles;
      throw "nope";
    });
    renderPanel();
    await waitFor(() => expect(screen.getAllByText("permissions:noPermissions")).toHaveLength(2));
  });

  it("成员/角色接口失败不阻塞权限列表", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === MEMBERS_PATH || path === ROLES_PATH) throw new Error("aux down");
      return { items: permissions, total: permissions.length };
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.queryByText("aux down")).not.toBeInTheDocument();
  });

  it("删除显式权限：确认后调用 DELETE 并本地移除", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("permissions:removePermission"));
    await waitFor(() => expect(screen.queryByText("Alice")).not.toBeInTheDocument());

    expect(mocks.api).toHaveBeenCalledWith(`${LIST_PATH}/p-1`, { method: "DELETE" });
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(listGetCalls()).toHaveLength(1);
  });

  it("取消确认不发起删除请求", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("permissions:removePermission"));
    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "DELETE")).toHaveLength(0),
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("删除失败显示错误且列表不变", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") throw new Error("delete-boom");
      if (path === MEMBERS_PATH) return members;
      if (path === ROLES_PATH) return roles;
      return { items: permissions, total: permissions.length };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("permissions:removePermission"));
    await waitFor(() => expect(screen.getByText("delete-boom")).toBeInTheDocument());
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("添加用户权限成功：POST 载荷正确、关闭表单并重新拉取", async () => {
    defaultApi();
    renderPanel();
    await waitFor(() => expect(screen.getByText("Admin")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "u-2" } });
    fireEvent.change(screen.getByLabelText("permissions:permissionLevel"), {
      target: { value: "manage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.queryByText("permissions:save")).not.toBeInTheDocument());
    const posts = mocks.api.mock.calls.filter(([p, o]) => p === LIST_PATH && o?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(bodyOf(posts[0])).toEqual({
      granteeType: "user",
      granteeId: "u-2",
      permissionLevel: "manage",
    });
    expect(listGetCalls()).toHaveLength(2);
  });

  it("切换授权对象类型清空已选 ID 并提交 role 类型", async () => {
    defaultApi();
    renderPanel();
    await waitFor(() => expect(screen.getByText("Admin")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "u-2" } });
    fireEvent.change(screen.getByLabelText("permissions:granteeType"), {
      target: { value: "role" },
    });
    expect(screen.getByLabelText("permissions:granteeId")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "r-1" } });
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() =>
      expect(
        mocks.api.mock.calls.filter(([p, o]) => p === LIST_PATH && o?.method === "POST"),
      ).toHaveLength(1),
    );
    const post = mocks.api.mock.calls.find(([p, o]) => p === LIST_PATH && o?.method === "POST");
    expect(bodyOf(post ?? [])).toEqual({
      granteeType: "role",
      granteeId: "r-1",
      permissionLevel: "view",
    });
  });

  it("未选择授权对象时提交被拦截且提示与标签同文", async () => {
    defaultApi();
    renderPanel();
    await waitFor(() => expect(screen.getByText("Admin")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.getAllByText("permissions:granteeId")).toHaveLength(2));
    expect(
      mocks.api.mock.calls.filter(([p, o]) => p === LIST_PATH && o?.method === "POST"),
    ).toHaveLength(0);
  });

  it("取消按钮重置表单字段", async () => {
    defaultApi();
    renderPanel();
    await waitFor(() => expect(screen.getByText("Admin")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "u-2" } });
    fireEvent.change(screen.getByLabelText("permissions:permissionLevel"), {
      target: { value: "manage" },
    });
    fireEvent.click(screen.getByText("permissions:cancel"));
    expect(screen.queryByText("permissions:save")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("permissions:addPermission"));
    expect(screen.getByLabelText("permissions:granteeId")).toHaveValue("");
    expect(screen.getByLabelText("permissions:permissionLevel")).toHaveValue("view");
  });

  it("提交失败保留表单并恢复按钮可用", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") throw new Error("save-boom");
      if (path === MEMBERS_PATH) return members;
      if (path === ROLES_PATH) return roles;
      return { items: permissions, total: permissions.length };
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Admin")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "u-2" } });
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.getByText("save-boom")).toBeInTheDocument());
    const saveBtn = screen.getByRole("button", { name: "permissions:save" });
    expect(saveBtn).toBeEnabled();
    expect(screen.getByLabelText("permissions:granteeId")).toHaveValue("u-2");
    expect(listGetCalls()).toHaveLength(1);
  });

  it("成员与角色接口兼容 {items} 信封", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === MEMBERS_PATH) return { items: members };
      if (path === ROLES_PATH) return { items: roles };
      return { items: [], total: 0 };
    });
    renderPanel();
    await waitFor(() => expect(screen.getByText("permissions:noPermissions")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    const select = screen.getByLabelText("permissions:granteeId") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Alice");
    expect(labels).toContain("bob@example.com");

    fireEvent.change(screen.getByLabelText("permissions:granteeType"), {
      target: { value: "role" },
    });
    const roleSelect = screen.getByLabelText("permissions:granteeId") as HTMLSelectElement;
    expect(Array.from(roleSelect.options).map((o) => o.textContent)).toContain("Admin");
  });
});
