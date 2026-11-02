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

const mocks = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/lib/i18n-navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

import { SettingsDangerZone } from "@/components/settings/SettingsDangerZone";
import type { Workspace } from "@/components/settings/types";

const onError = vi.fn();

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "Alpha",
    slug: "alpha",
    plan: "free",
    seatLimit: 10,
    memberCount: 3,
    taskCount: 12,
    createdAt: "2026-01-01T00:00:00Z",
    role: "owner",
    ...overrides,
  };
}

function makePreview(overrides: Record<string, unknown> = {}) {
  return {
    ownedWorkspaces: [{ id: "w-1", name: "Alpha", memberCount: 3 }],
    joinedWorkspaces: [{ id: "w-2", name: "Beta", role: "admin" }],
    calendarConnections: [],
    activeSubscription: null,
    stats: { ownedTasks: 0, ownedDecisions: 0, messages: 0 },
    ...overrides,
  };
}

function renderDangerZone(ws: Workspace | null = makeWorkspace(), wid = "ws-1") {
  return render(<SettingsDangerZone ws={ws} wid={wid} onError={onError} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SettingsDangerZone", () => {
  it("owner 可见删除工作区区与删除账户区", () => {
    renderDangerZone();
    expect(screen.getByText("settings:dangerTitle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings:deleteInit" })).toBeInTheDocument();
    expect(screen.getByText("accountDeletion:title")).toBeInTheDocument();
  });

  it("非 owner 时删除工作区入口隐藏，账户区仍渲染", () => {
    renderDangerZone(makeWorkspace({ role: "admin" }));
    expect(screen.queryByText("settings:dangerTitle")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "settings:deleteInit" })).not.toBeInTheDocument();
    expect(screen.getByText("accountDeletion:title")).toBeInTheDocument();
  });

  it("ws 为 null 时同上", () => {
    renderDangerZone(null);
    expect(screen.queryByRole("button", { name: "settings:deleteInit" })).not.toBeInTheDocument();
    expect(screen.getByText("accountDeletion:title")).toBeInTheDocument();
  });

  it("两步确认：第二步展示提示、标签与占位符", () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteInit" }));
    expect(screen.getByText('settings:deleteConfirmHint:{"name":"Alpha"}')).toBeInTheDocument();
    expect(screen.getByText('settings:deleteConfirmLabel:{"name":"Alpha"}')).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Alpha")).toBeInTheDocument();
  });

  it("确认钮在输入名字完全匹配前禁用，匹配后启用", () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteInit" }));
    const confirmBtn = screen.getByRole("button", { name: "settings:deleteConfirm" });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Alpha"), { target: { value: "Alph" } });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Alpha"), { target: { value: "Alpha" } });
    expect(confirmBtn).toBeEnabled();
  });

  it("取消回到第一步且再次展开时输入框已清空", () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteInit" }));
    fireEvent.change(screen.getByPlaceholderText("Alpha"), { target: { value: "Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteCancel" }));
    expect(screen.getByRole("button", { name: "settings:deleteInit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteInit" }));
    expect(screen.getByPlaceholderText("Alpha")).toHaveValue("");
  });

  it("输入不匹配 → 确认钮禁用且无任何请求", () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteInit" }));
    fireEvent.change(screen.getByPlaceholderText("Alpha"), { target: { value: "Alph" } });
    expect(screen.getByRole("button", { name: "settings:deleteConfirm" })).toBeDisabled();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("删除工作区成功 → DELETE 后跳首页", async () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteInit" }));
    fireEvent.change(screen.getByPlaceholderText("Alpha"), { target: { value: "Alpha" } });
    mocks.api.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteConfirm" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-1", { method: "DELETE" });
  });

  it("删除工作区失败（Error）→ onError 消息、按钮复位、不跳转", async () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteInit" }));
    fireEvent.change(screen.getByPlaceholderText("Alpha"), { target: { value: "Alpha" } });
    mocks.api.mockRejectedValueOnce(new Error("尚有成员"));
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteConfirm" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("尚有成员"));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "settings:deleteConfirm" })).toBeEnabled();
  });

  it("删除工作区失败（非 Error）→ settings:deleteFailed", async () => {
    renderDangerZone();
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteInit" }));
    fireEvent.change(screen.getByPlaceholderText("Alpha"), { target: { value: "Alpha" } });
    mocks.api.mockRejectedValueOnce("down");
    fireEvent.click(screen.getByRole("button", { name: "settings:deleteConfirm" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("settings:deleteFailed"));
  });

  it("账户预览加载中显示 loading，完成后消失", async () => {
    renderDangerZone();
    let resolveGet!: (value: unknown) => void;
    mocks.api.mockImplementationOnce(
      () =>
        new Promise<unknown>((r) => {
          resolveGet = r;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    expect(screen.getByText("accountDeletion:previewLoading")).toBeInTheDocument();
    resolveGet(makePreview());
    await waitFor(() =>
      expect(screen.queryByText("accountDeletion:previewLoading")).not.toBeInTheDocument(),
    );
  });

  it("账户预览渲染：拥有/加入工作区与角色文案", async () => {
    renderDangerZone();
    mocks.api.mockResolvedValueOnce(makePreview());
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(screen.getByText('accountDeletion:previewOwned:{"count":1}')).toBeInTheDocument(),
    );
    expect(screen.getByText(/· Alpha（3/)).toBeInTheDocument();
    expect(screen.getByText(/^· Beta（role:admin）$/)).toBeInTheDocument();
    expect(screen.getByText("accountDeletion:confirmHint")).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/users/me/account");
  });

  it("预览含统计与订阅时展示对应文案", async () => {
    renderDangerZone();
    mocks.api.mockResolvedValueOnce(
      makePreview({
        stats: { ownedTasks: 5, ownedDecisions: 2, messages: 9 },
        activeSubscription: { provider: "stripe", status: "active" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(
        screen.getByText('accountDeletion:previewStats:{"tasks":5,"decisions":2,"messages":9}'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText('accountDeletion:previewSubscription:{"provider":"stripe"}'),
    ).toBeInTheDocument();
  });

  it("预览失败 → 显示 previewFailed 但不阻断删除流程", async () => {
    renderDangerZone();
    mocks.api.mockRejectedValueOnce(new Error("down"));
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(screen.getByText("accountDeletion:previewFailed")).toBeInTheDocument(),
    );
    expect(screen.getByText("accountDeletion:confirmHint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "accountDeletion:confirm" })).toBeInTheDocument();
  });

  it("账户确认钮在输入含 @ 前禁用", async () => {
    renderDangerZone();
    mocks.api.mockResolvedValueOnce(makePreview());
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(screen.getByText("accountDeletion:confirmHint")).toBeInTheDocument(),
    );
    const confirmBtn = screen.getByRole("button", { name: "accountDeletion:confirm" });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("accountDeletion:confirmPlaceholder"), {
      target: { value: "a" },
    });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("accountDeletion:confirmPlaceholder"), {
      target: { value: "a@b.c" },
    });
    expect(confirmBtn).toBeEnabled();
  });

  it("删除账户成功 → 带 trim 后邮箱的 DELETE 并跳登录页", async () => {
    renderDangerZone();
    mocks.api.mockResolvedValueOnce(makePreview());
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(screen.getByText("accountDeletion:confirmHint")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("accountDeletion:confirmPlaceholder"), {
      target: { value: "  a@b.c  " },
    });
    mocks.api.mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:confirm" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/auth/login"));
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/users/me/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmEmail: "a@b.c" }),
    });
  });

  it("删除账户失败 → onError 消息且按钮复位", async () => {
    renderDangerZone();
    mocks.api.mockResolvedValueOnce(makePreview());
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(screen.getByText("accountDeletion:confirmHint")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("accountDeletion:confirmPlaceholder"), {
      target: { value: "a@b.c" },
    });
    mocks.api.mockRejectedValueOnce(new Error("邮箱不匹配"));
    const confirmBtn = screen.getByRole("button", { name: "accountDeletion:confirm" });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onError).toHaveBeenCalledWith("邮箱不匹配"));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(confirmBtn).toBeEnabled();
  });

  it("删除账户失败（非 Error）→ accountDeletion:failed", async () => {
    renderDangerZone();
    mocks.api.mockResolvedValueOnce(makePreview());
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(screen.getByText("accountDeletion:confirmHint")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("accountDeletion:confirmPlaceholder"), {
      target: { value: "a@b.c" },
    });
    mocks.api.mockRejectedValueOnce("down");
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:confirm" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("accountDeletion:failed"));
  });

  it("账户取消 → 折叠回 init 且再次展开输入框已清空", async () => {
    renderDangerZone();
    mocks.api.mockResolvedValueOnce(makePreview());
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(screen.getByText("accountDeletion:confirmHint")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText("accountDeletion:confirmPlaceholder"), {
      target: { value: "a@b.c" },
    });
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:cancel" }));
    expect(screen.getByRole("button", { name: "accountDeletion:init" })).toBeInTheDocument();
    mocks.api.mockResolvedValueOnce(makePreview());
    fireEvent.click(screen.getByRole("button", { name: "accountDeletion:init" }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("accountDeletion:confirmPlaceholder")).toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText("accountDeletion:confirmPlaceholder")).toHaveValue("");
  });
});
