// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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

const callbacks = vi.hoisted(() => ({
  onChangeRole: vi.fn(),
  onRemove: vi.fn(),
  onGrantTempRole: vi.fn(),
  onRevokeTempRole: vi.fn(),
}));

import type { Member, TemporaryGrant } from "@/lib/types";
import { MemberList } from "@/components/members/MemberList";

const baseMember: Member = {
  id: "u-1",
  email: "alice@example.com",
  name: "Alice",
  image: null,
  role: "member",
  isSelf: false,
  joinedAt: "2026-01-01T00:00:00Z",
};

const tempGrant: TemporaryGrant = {
  id: "tg-1",
  userId: "u-1",
  workspaceId: "ws-1",
  tempRole: "admin",
  originalRole: "member",
  expiresAt: "2026-12-31T23:59:59Z",
  reason: "临时提权",
  createdAt: "2026-11-01T00:00:00Z",
};

function renderList(
  props: {
    members?: Member[];
    canManage?: boolean;
    tempGrants?: TemporaryGrant[];
  } = {},
) {
  return render(
    <MemberList
      members={props.members ?? [baseMember]}
      canManage={props.canManage ?? true}
      onChangeRole={callbacks.onChangeRole}
      onRemove={callbacks.onRemove}
      tempGrants={props.tempGrants ?? []}
      onGrantTempRole={callbacks.onGrantTempRole}
      onRevokeTempRole={callbacks.onRevokeTempRole}
    />,
  );
}

// MemberList 渲染两套布局（row + card），同一元素会出现两次；
// 断言按行布局（DOM 中靠前的那个）取 [0]。
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  callbacks.onChangeRole.mockClear();
  callbacks.onRemove.mockClear();
  callbacks.onGrantTempRole.mockClear();
  callbacks.onRevokeTempRole.mockClear();
});

describe("MemberList", () => {
  it("渲染成员姓名与邮箱", () => {
    renderList();

    expect(screen.getAllByText("Alice")[0]).toBeInTheDocument();
    expect(screen.getAllByText("alice@example.com")[0]).toBeInTheDocument();
  });

  it("当前用户显示 you 徽章", () => {
    renderList({ members: [{ ...baseMember, isSelf: true }] });

    expect(screen.getAllByText("members:you")[0]).toBeInTheDocument();
  });

  it("不可编辑时显示角色徽标而非 select", () => {
    renderList({ canManage: false });

    expect(screen.getAllByText("role:member")[0]).toBeInTheDocument();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("可编辑时显示角色 select 与三个选项", () => {
    renderList();

    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    expect(selects[0]).toHaveValue("member");
    const options = selects[0].querySelectorAll("option");
    expect([...options].map((o) => o.value)).toEqual(["member", "admin", "viewer"]);
  });

  it("切换角色调用 onChangeRole(uid, role)", () => {
    renderList();

    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "admin" } });
    expect(callbacks.onChangeRole).toHaveBeenCalledWith("u-1", "admin");
  });

  it("有效临时授权显示徽章与按钮", () => {
    renderList({ tempGrants: [tempGrant] });

    expect(screen.getAllByText("members:tempGrantAdmin")[0]).toBeInTheDocument();
    // 行布局按钮用 aria-label="members:tempGrant"（card 布局用文本 "members:tempGrantManage"）
    expect(screen.getAllByRole("button", { name: "members:tempGrant" })).toHaveLength(1);
  });

  it("点击临时授权按钮调用 onGrantTempRole", () => {
    renderList({ tempGrants: [tempGrant] });

    const buttons = screen.getAllByRole("button", { name: "members:tempGrant" });
    fireEvent.click(buttons[0]);
    expect(callbacks.onGrantTempRole).toHaveBeenCalledWith(baseMember);
  });

  it("有效临时授权时显示撤销按钮并点击调用 onRevokeTempRole", () => {
    renderList({ tempGrants: [tempGrant] });

    const buttons = screen.getAllByRole("button", { name: "members:revokeTempPermission" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(callbacks.onRevokeTempRole).toHaveBeenCalledWith("u-1");
  });

  it("删除：首次点击进入确认态，再次点击才调用 onRemove", () => {
    renderList();

    const removeBtns = screen.getAllByRole("button", { name: "members:remove Alice" });
    expect(removeBtns).toHaveLength(2);

    // 两套布局各一枚删除按钮，全部点进确认态
    fireEvent.click(removeBtns[0]);
    fireEvent.click(removeBtns[1]);
    expect(callbacks.onRemove).not.toHaveBeenCalled();

    // 确认态：可访问名变为 removeConfirm 串，两套布局各一枚
    const confirmBtns = screen.getAllByRole("button", {
      name: 'members:removeConfirm:{"name":"Alice"}',
    });
    expect(confirmBtns).toHaveLength(2);
    fireEvent.click(confirmBtns[0]);
    expect(callbacks.onRemove).toHaveBeenCalledTimes(1);
    expect(callbacks.onRemove).toHaveBeenCalledWith("u-1", "Alice");
  });

  it("删除确认态 blur 后重置，不再调用 onRemove", () => {
    renderList();

    const removeBtns = screen.getAllByRole("button", { name: "members:remove Alice" });
    fireEvent.click(removeBtns[0]);
    expect(callbacks.onRemove).not.toHaveBeenCalled();

    const confirmBtns = screen.getAllByRole("button", {
      name: 'members:removeConfirm:{"name":"Alice"}',
    });
    fireEvent.blur(confirmBtns[0]);

    // blur 重置后，再点 original remove 按钮应重新进入确认态而非直接删除
    fireEvent.click(removeBtns[0]);
    expect(callbacks.onRemove).not.toHaveBeenCalled();
  });

  it("viewer 角色显示 viewerHint", () => {
    renderList({ members: [{ ...baseMember, role: "viewer" }] });

    expect(screen.getAllByText("members:viewerHint")[0]).toBeInTheDocument();
  });

  it("空成员列表不渲染任何行", () => {
    renderList({ members: [] });

    expect(screen.queryAllByText("Alice")).toHaveLength(0);
    expect(screen.queryAllByText("alice@example.com")).toHaveLength(0);
  });
});
