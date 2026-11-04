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
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  onRevoke: vi.fn(),
}));

import type { Member, TemporaryGrant } from "@/lib/types";
import { TemporaryGrantModal } from "@/components/members/TemporaryGrantModal";

const target: Member = {
  id: "u-2",
  email: "bob@example.com",
  name: "Bob",
  image: null,
  role: "member",
  isSelf: false,
  joinedAt: "2026-01-01T00:00:00Z",
};

const existingGrant: TemporaryGrant = {
  id: "tg-1",
  userId: "u-2",
  workspaceId: "ws-1",
  tempRole: "admin",
  originalRole: "member",
  expiresAt: "2026-12-31T23:59:59Z",
  reason: "已有授权",
  createdAt: "2026-11-01T00:00:00Z",
};

function renderModal(
  props: {
    existingGrant?: TemporaryGrant | null;
    busy?: boolean;
  } = {},
) {
  return render(
    <TemporaryGrantModal
      target={target}
      existingGrant={props.existingGrant ?? null}
      busy={props.busy ?? false}
      onClose={callbacks.onClose}
      onConfirm={callbacks.onConfirm}
      onRevoke={callbacks.onRevoke}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  callbacks.onClose.mockClear();
  callbacks.onConfirm.mockClear();
  callbacks.onRevoke.mockClear();
});

describe("TemporaryGrantModal", () => {
  it("渲染对话框标题、目标名与描述", () => {
    renderModal();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("members:tempGrant")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("members:tempGrantDesc")).toBeInTheDocument();
  });

  it("渲染关闭按钮（X 图标）", () => {
    renderModal();

    const closeBtn = screen.getByRole("button", { name: "button:close" });
    expect(closeBtn).toBeInTheDocument();
    expect(closeBtn.querySelector("svg")).not.toBeNull();
  });

  it("无既有授权时角色默认 admin", () => {
    renderModal();

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("admin");
  });

  it("切换持续时间按钮可选中", () => {
    renderModal();

    const btns = screen.getAllByRole("button", { name: "members:duration48h" });
    expect(btns).toHaveLength(1);
    fireEvent.click(btns[0]);
    expect(btns[0]).toHaveClass(/bg-\[var\(--accent\)\]/);
  });

  it("理由输入框可填写", () => {
    renderModal();

    const input = screen.getByRole("textbox", { name: "members:grantReason" });
    fireEvent.input(input, { target: { value: "紧急排障" } });
    expect(input).toHaveValue("紧急排障");
  });

  it("既有有效授权显示当前角色与撤销按钮", () => {
    renderModal({ existingGrant });

    // 内层 t("tempGrantAdmin") 先渲染为 key 串，外层 t("tempGrantCurrent") 再包一层
    expect(
      screen.getAllByText('members:tempGrantCurrent:{"role":"members:tempGrantAdmin"}')[0],
    ).toBeInTheDocument();
    const revokeBtns = screen.getAllByRole("button", { name: "members:tempGrantRevokeNow" });
    expect(revokeBtns).toHaveLength(1);
    fireEvent.click(revokeBtns[0]);
    expect(callbacks.onRevoke).toHaveBeenCalledTimes(1);
  });

  it("点击关闭按钮调用 onClose", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "button:close" }));
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("点击取消按钮调用 onClose", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "button:cancel" }));
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it("确认按钮忙时禁用", () => {
    renderModal({ busy: true });

    const confirmBtn = screen.getByRole("button", { name: "members:tempGrantSubmitting" });
    expect(confirmBtn).toBeDisabled();
  });

  it("确认按钮传入 target、角色、时长、理由调用 onConfirm", () => {
    renderModal();

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "member" } });

    const input = screen.getByRole("textbox", { name: "members:grantReason" });
    fireEvent.input(input, { target: { value: "理由" } });

    const durationBtns = screen.getAllByRole("button", { name: "members:duration4h" });
    fireEvent.click(durationBtns[0]);

    const confirmBtn = screen.getByRole("button", { name: "members:grantTempPermission" });
    fireEvent.click(confirmBtn);

    expect(callbacks.onConfirm).toHaveBeenCalledWith(target, "member", 4, "理由");
  });

  it("按 Escape 键调用 onClose", () => {
    renderModal();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});
