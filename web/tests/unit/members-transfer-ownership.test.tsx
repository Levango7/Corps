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
  setTransferOpen: vi.fn(),
  setTransferTarget: vi.fn(),
  onTransfer: vi.fn(),
}));

import type { Member } from "@/lib/types";
import { TransferOwnership } from "@/components/members/TransferOwnership";

const members: Member[] = [
  {
    id: "u-1",
    email: "alice@example.com",
    name: "Alice",
    image: null,
    role: "owner",
    isSelf: true,
    joinedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "u-2",
    email: "bob@example.com",
    name: "Bob",
    image: null,
    role: "member",
    isSelf: false,
    joinedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "u-3",
    email: "carol@example.com",
    name: "Carol",
    image: null,
    role: "member",
    isSelf: false,
    joinedAt: "2026-01-01T00:00:00Z",
  },
];

function renderTransfer(
  props: {
    members?: Member[];
    transferOpen?: boolean;
    transferTarget?: string;
    transferBusy?: boolean;
  } = {},
) {
  return render(
    <TransferOwnership
      members={props.members ?? members}
      transferOpen={props.transferOpen ?? false}
      setTransferOpen={callbacks.setTransferOpen}
      transferTarget={props.transferTarget ?? ""}
      setTransferTarget={callbacks.setTransferTarget}
      transferBusy={props.transferBusy ?? false}
      onTransfer={callbacks.onTransfer}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  callbacks.setTransferOpen.mockClear();
  callbacks.setTransferTarget.mockClear();
  callbacks.onTransfer.mockClear();
});

describe("TransferOwnership", () => {
  it("有可转让成员时显示转让按钮", () => {
    renderTransfer();

    expect(screen.getByRole("button", { name: "members:transfer" })).toBeEnabled();
  });

  it("无可转让成员时转让按钮禁用", () => {
    renderTransfer({
      members: [{ ...members[0], isSelf: true, role: "owner" }],
    });

    expect(screen.getByRole("button", { name: "members:transfer" })).toBeDisabled();
  });

  it("点击转让按钮调用 setTransferOpen(true)", () => {
    renderTransfer();

    fireEvent.click(screen.getByRole("button", { name: "members:transfer" }));
    expect(callbacks.setTransferOpen).toHaveBeenCalledWith(true);
  });

  it("展开后渲染下拉、确认与取消按钮", () => {
    renderTransfer({ transferOpen: true });

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(screen.getByText("members:transferConfirmHint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "members:transferConfirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "members:transferCancel" })).toBeInTheDocument();
  });

  it("下拉选项仅列出非自身且非 owner 的成员", () => {
    renderTransfer({ transferOpen: true });

    const select = screen.getByRole("combobox");
    const options = select.querySelectorAll("option");
    const values = [...options].map((o) => o.value);
    expect(values).toEqual(["", "u-2", "u-3"]);
  });

  it("选择成员后设置 transferTarget", () => {
    renderTransfer({ transferOpen: true });

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "u-2" } });
    expect(callbacks.setTransferTarget).toHaveBeenCalledWith("u-2");
  });

  it("未选目标时确认按钮禁用", () => {
    renderTransfer({ transferOpen: true, transferTarget: "" });

    expect(screen.getByRole("button", { name: "members:transferConfirm" })).toBeDisabled();
  });

  it("选目标后点确认调用 onTransfer", () => {
    renderTransfer({ transferOpen: true, transferTarget: "u-2" });

    fireEvent.click(screen.getByRole("button", { name: "members:transferConfirm" }));
    expect(callbacks.onTransfer).toHaveBeenCalledTimes(1);
  });

  it("点击取消关闭并清空目标", () => {
    renderTransfer({ transferOpen: true, transferTarget: "u-2" });

    fireEvent.click(screen.getByRole("button", { name: "members:transferCancel" }));
    expect(callbacks.setTransferOpen).toHaveBeenCalledWith(false);
    expect(callbacks.setTransferTarget).toHaveBeenCalledWith("");
  });

  it("忙时确认按钮禁用", () => {
    renderTransfer({ transferOpen: true, transferTarget: "u-2", transferBusy: true });

    expect(screen.getByRole("button", { name: "members:transferConfirm" })).toBeDisabled();
  });

  it("无可转让成员时显示 transferEmptyList", () => {
    renderTransfer({ members: [members[0]] });

    expect(screen.getByText("members:transferEmptyList")).toBeInTheDocument();
  });
});
