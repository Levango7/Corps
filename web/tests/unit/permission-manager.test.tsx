// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * PermissionManager 契约（components/doc/PermissionManager.tsx，named export）：
 *  1. 挂载并行加载：GET /api/v1/workspaces/{wid}/documents/{did}/permissions（api）
 *     与 GET /api/v1/workspaces/{wid}/members（apiList），先显示 loading
 *  2. 任一加载失败被 .catch 吞掉 → 按空数据处理（permissions 接口挂也显示 noMembers，不崩）
 *  3. 权限行：user 授权显示成员 name（无 name 回退 email，成员缺失回退 granteeId）；
 *     role 授权直接显示 granteeId；每行一个级别 select（view/edit/manage）+ 删除按钮
 *  4. 添加表单：成员下拉（过滤掉已授权 user）+ 级别下拉 + 添加按钮
 *     （!selectedUserId || busy 时 disabled）；提交 POST body
 *     { granteeType:"user", granteeId, permission }，成功追加行并重置选择
 *  5. 行内 select 修改 → PATCH /permissions/{pid} body { permission }，行替换为响应
 *  6. 删除：window.confirm 确认 → DELETE /permissions/{pid}，行移除
 *  7. add/update/remove 失败 → 错误条显示 e.message
 *  8. permissions 为空 → noMembers 空态
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  apiList: vi.fn(),
}));

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
vi.mock("@/lib/api", () => ({ api: mocks.api, apiList: mocks.apiList }));

import { PermissionManager } from "@/components/doc/PermissionManager";

const WID = "ws-pm-1";
const DID = "doc-pm-1";
const PERM_URL = "/api/v1/workspaces/ws-pm-1/documents/doc-pm-1/permissions";
const MEMBERS_URL = "/api/v1/workspaces/ws-pm-1/members";

const MEMBERS = [
  { id: "u-1", name: "Alice", email: "alice@example.com", role: "admin" },
  { id: "u-2", name: null, email: "bob@example.com", role: "member" },
];

const P1 = {
  id: "p-1",
  documentId: DID,
  workspaceId: WID,
  granteeType: "user",
  granteeId: "u-1",
  permission: "view",
  grantedBy: null,
  createdAt: new Date().toISOString(),
  granter: null,
};

const P2 = {
  id: "p-2",
  documentId: DID,
  workspaceId: WID,
  granteeType: "role",
  granteeId: "role-admin",
  permission: "edit",
  grantedBy: null,
  createdAt: new Date().toISOString(),
  granter: null,
};

function renderManager() {
  return render(<PermissionManager docId={DID} workspaceId={WID} />);
}

/** 行内权限 select（li 直接子级），按行序返回 */
function rowSelects(container: HTMLElement) {
  return Array.from(container.querySelectorAll("li > select")) as HTMLSelectElement[];
}

/** 添加表单的两个 select：成员下拉（首 option=searchUser）与级别下拉 */
function formSelects(container: HTMLElement) {
  const selects = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
  const userSelect = selects.find((s) => s.options[0]?.textContent === "doc:searchUser")!;
  const permSelect = selects.filter((s) => s.closest("li") === null).find((s) => s !== userSelect)!;
  return { userSelect, permSelect };
}

function removeButtons() {
  return screen.getAllByLabelText("doc:removePermission");
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
  mocks.api.mockResolvedValue({ items: [] });
  mocks.apiList.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("PermissionManager", () => {
  it("挂载并行加载：permissions URL 与 members URL 精确断言，期间显示 loading", () => {
    renderManager();

    expect(mocks.api).toHaveBeenCalledWith(PERM_URL);
    expect(mocks.apiList).toHaveBeenCalledWith(MEMBERS_URL);
    expect(screen.getByText("doc:loading")).toBeInTheDocument();
  });

  it("成功渲染权限行：user 显示成员名、role 显示 granteeId、级别 select 值正确", async () => {
    mocks.api.mockResolvedValueOnce({ items: [P1, P2] });
    mocks.apiList.mockResolvedValueOnce(MEMBERS);
    const { container } = renderManager();
    await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

    expect(screen.getByText("Alice")).toBeInTheDocument(); // u-1 成员名
    expect(screen.getByText("role-admin")).toBeInTheDocument(); // role 直接显示
    const rows = rowSelects(container);
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe("view");
    expect(rows[1].value).toBe("edit");
    // 级别 option 文案走 t(permissionXxx)
    expect(Array.from(rows[0].options).map((o) => o.textContent)).toEqual([
      "doc:permissionView",
      "doc:permissionEdit",
      "doc:permissionManage",
    ]);
  });

  it("user 授权成员缺 name 时回退 email；成员列表缺失时回退 granteeId", async () => {
    mocks.api.mockResolvedValueOnce({
      items: [
        P1,
        { ...P1, id: "p-1b", granteeId: "u-2" },
        { ...P1, id: "p-1c", granteeId: "ghost-1" },
      ],
    });
    mocks.apiList.mockResolvedValueOnce(MEMBERS);
    renderManager();
    await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument(); // u-2 无 name → email
    expect(screen.getByText("ghost-1")).toBeInTheDocument(); // 不在成员表 → granteeId
  });

  it("权限为空 → noMembers 空态；permissions 接口失败也被 catch 吞掉显示 noMembers", async () => {
    mocks.api.mockResolvedValueOnce({ items: [] });
    mocks.apiList.mockResolvedValueOnce(MEMBERS);
    const first = renderManager();
    await waitFor(() => expect(screen.getByText("doc:noMembers")).toBeInTheDocument());
    first.unmount();

    // cleanup 后不能对已卸载树 rerender——重新 render 一棵新树
    mocks.api.mockRejectedValueOnce(new Error("perm boom"));
    mocks.apiList.mockResolvedValueOnce([]);
    renderManager();
    await waitFor(() => expect(screen.getByText("doc:noMembers")).toBeInTheDocument());
    expect(screen.queryByText("perm boom")).toBeFalsy();
  });

  it("添加按钮未选成员时 disabled；已授权成员被过滤出下拉", async () => {
    mocks.api.mockResolvedValueOnce({ items: [P1] }); // u-1 已授权
    mocks.apiList.mockResolvedValueOnce(MEMBERS);
    const { container } = renderManager();
    await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

    const addBtn = screen.getByText("doc:addPermission").closest("button")!;
    expect(addBtn).toBeDisabled();

    const { userSelect } = formSelects(container);
    const optionValues = Array.from(userSelect.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "u-2"]); // u-1 已授权被过滤，仅剩 u-2
  });

  it("添加权限：POST body 精确 → 新行追加（email 回退显示）并重置选择", async () => {
    const created = { ...P1, id: "p-3", granteeId: "u-2", permission: "edit" };
    mocks.api.mockResolvedValueOnce({ items: [] });
    mocks.apiList.mockResolvedValueOnce(MEMBERS);
    mocks.api.mockResolvedValueOnce(created);
    const { container } = renderManager();
    await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

    const { userSelect, permSelect } = formSelects(container);
    fireEvent.change(userSelect, { target: { value: "u-2" } });
    fireEvent.change(permSelect, { target: { value: "edit" } });
    fireEvent.click(screen.getByText("doc:addPermission").closest("button")!);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith(PERM_URL, {
      method: "POST",
      body: JSON.stringify({ granteeType: "user", granteeId: "u-2", permission: "edit" }),
    });
    await waitFor(() => expect(screen.getByText("bob@example.com")).toBeInTheDocument());
    expect(formSelects(container).userSelect.value).toBe(""); // 重置
  });

  it("添加失败：错误条显示 e.message，不追加行", async () => {
    mocks.api.mockResolvedValueOnce({ items: [] });
    mocks.apiList.mockResolvedValueOnce(MEMBERS);
    mocks.api.mockRejectedValueOnce(new Error("add boom"));
    const { container } = renderManager();
    await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

    const { userSelect } = formSelects(container);
    fireEvent.change(userSelect, { target: { value: "u-2" } });
    fireEvent.click(screen.getByText("doc:addPermission").closest("button")!);

    await waitFor(() => expect(screen.getByText("add boom")).toBeInTheDocument());
    expect(rowSelects(container)).toHaveLength(0);
  });

  it("行内级别修改：PATCH /permissions/{pid} body { permission }，行替换为响应值", async () => {
    mocks.api.mockResolvedValueOnce({ items: [P1] });
    mocks.apiList.mockResolvedValueOnce(MEMBERS);
    mocks.api.mockResolvedValueOnce({ ...P1, permission: "manage" });
    const { container } = renderManager();
    await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

    fireEvent.change(rowSelects(container)[0], { target: { value: "manage" } });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith(`${PERM_URL}/p-1`, {
      method: "PATCH",
      body: JSON.stringify({ permission: "manage" }),
    });
    await waitFor(() => expect(rowSelects(container)[0].value).toBe("manage"));
  });

  it("级别修改失败：错误条显示 e.message，行值不变", async () => {
    mocks.api.mockResolvedValueOnce({ items: [P1] });
    mocks.apiList.mockResolvedValueOnce(MEMBERS);
    mocks.api.mockRejectedValueOnce(new Error("patch boom"));
    const { container } = renderManager();
    await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

    fireEvent.change(rowSelects(container)[0], { target: { value: "manage" } });
    await waitFor(() => expect(screen.getByText("patch boom")).toBeInTheDocument());
    expect(rowSelects(container)[0].value).toBe("view");
  });

  it("删除：confirm true → DELETE /permissions/{pid}，行移除", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      mocks.api.mockResolvedValueOnce({ items: [P1, P2] });
      mocks.apiList.mockResolvedValueOnce(MEMBERS);
      mocks.api.mockResolvedValueOnce(undefined);
      const { container } = renderManager();
      await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

      fireEvent.click(removeButtons()[0]);
      await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
      expect(mocks.api).toHaveBeenLastCalledWith(`${PERM_URL}/p-1`, { method: "DELETE" });
      // 行移除：行 select 从 2 条降到 1 条（注意 u-1 会重新回到添加下拉，故不断言文本消失）
      await waitFor(() => expect(rowSelects(container)).toHaveLength(1));
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("删除：confirm false → 不发 DELETE，行保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      mocks.api.mockResolvedValueOnce({ items: [P1] });
      mocks.apiList.mockResolvedValueOnce(MEMBERS);
      const { container } = renderManager();
      await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

      fireEvent.click(removeButtons()[0]);
      expect(mocks.api).toHaveBeenCalledTimes(1);
      expect(rowSelects(container)).toHaveLength(1);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("删除失败：错误条显示 e.message，行保留", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      mocks.api.mockResolvedValueOnce({ items: [P1] });
      mocks.apiList.mockResolvedValueOnce(MEMBERS);
      mocks.api.mockRejectedValueOnce(new Error("delete boom"));
      const { container } = renderManager();
      await waitFor(() => expect(screen.queryByText("doc:loading")).toBeFalsy());

      fireEvent.click(removeButtons()[0]);
      await waitFor(() => expect(screen.getByText("delete boom")).toBeInTheDocument());
      expect(rowSelects(container)).toHaveLength(1);
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
