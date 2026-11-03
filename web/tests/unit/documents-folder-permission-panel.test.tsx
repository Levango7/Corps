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

import { FolderPermissionPanel } from "@/components/documents/FolderPermissionPanel";

const FOLDER_PATH = "/api/v1/workspaces/ws-1/folders/f-1/permissions";
const SPACE_PATH = "/api/v1/workspaces/ws-1/spaces/s-1/permissions";

const items = [
  {
    id: "fp-1",
    granteeType: "user",
    granteeId: "u-1",
    granteeName: "Alice",
    permissionLevel: "manage",
    inheritable: true,
    source: "explicit",
    grantedBy: "u-root",
    grantedByName: "Root",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "fp-2",
    granteeType: "role",
    granteeId: "r-1",
    permissionLevel: "view",
    inheritable: false,
    source: "inherited",
    inheritedFrom: "Space A",
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "fp-3",
    granteeType: "user",
    granteeId: "u-3",
    permissionLevel: "edit",
    inheritable: false,
    source: "explicit",
    createdAt: "2026-01-01T00:00:00Z",
  },
];

function bodyOf(call: unknown[]): {
  granteeType?: string;
  granteeId?: string;
  permissionLevel?: string;
  inheritable?: boolean;
} {
  return JSON.parse((call[1] as { body: string }).body);
}

function defaultApi(basePath: string) {
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (opts?.method === "DELETE" || opts?.method === "POST") return {};
    if (path === basePath) return { items, total: items.length };
    return [];
  });
}

function listGetCalls(basePath: string) {
  return mocks.api.mock.calls.filter(
    ([p, o]) => p === basePath && (!o || !o.method || o.method === "GET"),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FolderPermissionPanel", () => {
  it("folder 模式：标题为 folderPermissions 且请求 folders 路径", async () => {
    defaultApi(FOLDER_PATH);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() =>
      expect(screen.getByText("permissions:folderPermissions")).toBeInTheDocument(),
    );
    expect(mocks.api.mock.calls[0][0]).toBe(FOLDER_PATH);
  });

  it("space 模式：标题为 spacePermissions 且请求 spaces 路径", async () => {
    defaultApi(SPACE_PATH);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="space" targetId="s-1" />);
    await waitFor(() =>
      expect(screen.getByText("permissions:spacePermissions")).toBeInTheDocument(),
    );
    expect(mocks.api.mock.calls[0][0]).toBe(SPACE_PATH);
  });

  it("兼容裸数组响应", async () => {
    mocks.api.mockImplementation(async () => items);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  });

  it("列表渲染：名称回退、级别徽章、可继承标记、继承来源、仅 explicit 可删", async () => {
    defaultApi(FOLDER_PATH);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    expect(screen.getByText("r-1")).toBeInTheDocument();
    expect(screen.getAllByText("permissions:user")).toHaveLength(2);
    expect(screen.getByText("permissions:role")).toBeInTheDocument();
    expect(screen.getByText("permissions:manage")).toBeInTheDocument();
    expect(screen.getByText("permissions:view")).toBeInTheDocument();
    expect(screen.getByText("permissions:edit")).toBeInTheDocument();
    expect(screen.getByText("permissions:inheritable")).toBeInTheDocument();
    expect(screen.getByText("permissions:inheritedFrom: Space A")).toBeInTheDocument();
    expect(screen.getByText("permissions:grantedBy: Root")).toBeInTheDocument();
    expect(screen.getAllByLabelText("permissions:removePermission")).toHaveLength(2);
  });

  it("空列表显示空态", async () => {
    mocks.api.mockImplementation(async () => ({ items: [], total: 0 }));
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("permissions:noPermissions")).toBeInTheDocument());
  });

  it("加载中显示加载文案", () => {
    defaultApi(FOLDER_PATH);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    expect(screen.getByText("permissions:loadFailed")).toBeInTheDocument();
  });

  it("ApiError 消息直显，非错误对象回退 loadFailed", async () => {
    mocks.api.mockImplementation(async () => {
      throw new mocks.ApiErrorClass("folder-boom");
    });
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("folder-boom")).toBeInTheDocument());
  });

  it("非 Error 抛出时回退到 loadFailed 文案", async () => {
    mocks.api.mockImplementation(async () => {
      throw "nope";
    });
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("permissions:loadFailed")).toBeInTheDocument());
  });

  it("删除显式权限：确认后 DELETE 并本地移除", async () => {
    defaultApi(FOLDER_PATH);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("permissions:removePermission")[0]);
    await waitFor(() => expect(screen.queryByText("Alice")).not.toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledWith(`${FOLDER_PATH}/fp-1`, { method: "DELETE" });
    expect(listGetCalls(FOLDER_PATH)).toHaveLength(1);
  });

  it("取消确认不发起删除", async () => {
    defaultApi(FOLDER_PATH);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("permissions:removePermission")[0]);
    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "DELETE")).toHaveLength(0),
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("删除失败显示错误且列表不变", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") throw new Error("remove-boom");
      return { items, total: items.length };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("permissions:removePermission")[0]);
    await waitFor(() => expect(screen.getByText("remove-boom")).toBeInTheDocument());
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("onClose 存在时渲染关闭按钮并回调", async () => {
    defaultApi(FOLDER_PATH);
    const onClose = vi.fn();
    render(
      <FolderPermissionPanel
        workspaceId="ws-1"
        targetType="folder"
        targetId="f-1"
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("permissions:close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("新增权限：granteeId 去空格、inheritable 入载荷并重新拉取", async () => {
    defaultApi(FOLDER_PATH);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), {
      target: { value: "  u-9  " },
    });
    fireEvent.change(screen.getByLabelText("permissions:permissionLevel"), {
      target: { value: "edit" },
    });
    fireEvent.click(screen.getByLabelText("permissions:inheritable"));
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.queryByText("permissions:save")).not.toBeInTheDocument());
    const posts = mocks.api.mock.calls.filter(
      ([p, o]) => p === FOLDER_PATH && o?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(bodyOf(posts[0])).toEqual({
      granteeType: "user",
      granteeId: "u-9",
      permissionLevel: "edit",
      inheritable: true,
    });
    expect(listGetCalls(FOLDER_PATH)).toHaveLength(2);
  });

  it("切换授权对象类型与级别后提交对应载荷", async () => {
    defaultApi(FOLDER_PATH);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeType"), {
      target: { value: "role" },
    });
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "r-2" } });
    fireEvent.change(screen.getByLabelText("permissions:permissionLevel"), {
      target: { value: "comment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() =>
      expect(
        mocks.api.mock.calls.filter(([p, o]) => p === FOLDER_PATH && o?.method === "POST"),
      ).toHaveLength(1),
    );
    const post = mocks.api.mock.calls.find(([p, o]) => p === FOLDER_PATH && o?.method === "POST");
    expect(bodyOf(post ?? [])).toEqual({
      granteeType: "role",
      granteeId: "r-2",
      permissionLevel: "comment",
      inheritable: false,
    });
  });

  it("空白授权 ID 提交被拦截并提示", async () => {
    defaultApi(FOLDER_PATH);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.getAllByText("permissions:granteeId")).toHaveLength(2));
    expect(
      mocks.api.mock.calls.filter(([p, o]) => p === FOLDER_PATH && o?.method === "POST"),
    ).toHaveLength(0);
  });

  it("提交失败保留表单并恢复按钮可用", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") throw new Error("create-boom");
      return { items, total: items.length };
    });
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "u-9" } });
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.getByText("create-boom")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "permissions:save" })).toBeEnabled();
    expect(screen.getByLabelText("permissions:granteeId")).toHaveValue("u-9");
  });

  it("取消只关闭表单，不重置已填字段", async () => {
    defaultApi(FOLDER_PATH);
    render(<FolderPermissionPanel workspaceId="ws-1" targetType="folder" targetId="f-1" />);
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:addPermission"));
    fireEvent.change(screen.getByLabelText("permissions:granteeId"), { target: { value: "u-9" } });
    fireEvent.change(screen.getByLabelText("permissions:permissionLevel"), {
      target: { value: "edit" },
    });
    fireEvent.click(screen.getByLabelText("permissions:inheritable"));
    fireEvent.click(screen.getByText("permissions:cancel"));
    expect(screen.queryByText("permissions:save")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("permissions:addPermission"));
    expect(screen.getByLabelText("permissions:granteeId")).toHaveValue("u-9");
    expect(screen.getByLabelText("permissions:permissionLevel")).toHaveValue("edit");
    expect(screen.getByLabelText("permissions:inheritable")).toBeChecked();
  });
});
