// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * NotificationBadge 契约（components/notifications/NotificationBadge.tsx，named 导出）
 *  1. 挂载即 GET /api/v1/notifications/unread?workspaceId={wid}&limit=20，带 AbortSignal
 *  2. total>0 才渲染计数徽章（aria-label 带 count，>99 → "99+"）
 *  3. 点铃铛开面板并**再次**拉取未读；面板 role=dialog；关闭按钮 / 点遮罩都能关
 *  4. 未读项文案 = formatType(type) + entityTitle；未知 type 原样显示；createdAt 走 toLocaleString
 *  5. 空态 t("noUnreadNotifications")；加载中 t("loading")；失败 t("error")（error 分支遮蔽列表）
 *  6. 单条已读：PATCH /api/v1/notifications/{id}?workspaceId={wid}，body {"read":true}，
 *     成功后本地移除该条并减总数
 *  7. 全部已读：逐条 PATCH（Promise.all），成功后清空列表与总数
 *
 * 注意：组件 catch 里 `e instanceof ApiError`，所以 mock 必须同时导出 ApiError 类，
 * 否则 instanceof 右值为 undefined 会抛 TypeError。
 */

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    readonly status: number;
    readonly code: number;
    constructor(message: string, status: number, code = status) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }
  return { api: vi.fn(), apiList: vi.fn(), ApiError };
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
vi.mock("@/lib/api", () => ({
  api: mocks.api,
  apiList: mocks.apiList,
  ApiError: mocks.ApiError,
}));

import { NotificationBadge } from "@/components/notifications/NotificationBadge";

const WID = "ws-1";
const UNREAD_URL = `/api/v1/notifications/unread?workspaceId=${WID}&limit=20`;

const badgeLabel = (count: number) => `notifications:unreadCount:${JSON.stringify({ count })}`;

interface Item {
  id: string;
  type: string;
  entityId: string;
  entityTitle: string;
  read: boolean;
  createdAt: string;
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "n1",
    type: "mention",
    entityId: "e1",
    entityTitle: "任务甲",
    read: false,
    createdAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

/** 铃铛按钮（面板打开后 role=dialog 同名，但只有铃铛是 button） */
const bellButton = () => screen.getByRole("button", { name: "notifications:title" });

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
});
afterEach(() => cleanup());

describe("NotificationBadge", () => {
  it("挂载即请求未读列表：URL 精确 + 传 AbortSignal", async () => {
    mocks.api.mockResolvedValue({ total: 3, items: [makeItem()] });

    render(<NotificationBadge workspaceId={WID} />);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    const [url, opts] = mocks.api.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(UNREAD_URL);
    expect(opts.method).toBeUndefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("total>0 渲染计数徽章，文案与 aria-label 一致", async () => {
    mocks.api.mockResolvedValue({ total: 3, items: [makeItem()] });

    render(<NotificationBadge workspaceId={WID} />);

    const badge = await screen.findByLabelText(badgeLabel(3));
    expect(badge).toHaveTextContent("3");
    expect(bellButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("未读 0：不渲染徽章，打开面板显示空态", async () => {
    mocks.api.mockResolvedValue({ total: 0, items: [] });

    render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));

    expect(screen.queryByLabelText(badgeLabel(0))).toBeNull();
    expect(document.querySelector('span[aria-label^="notifications:unreadCount"]')).toBeNull();

    fireEvent.click(bellButton());
    await waitFor(() =>
      expect(screen.getByText("notifications:noUnreadNotifications")).toBeInTheDocument(),
    );
  });

  it("未读 >99：徽章显示 99+，aria-label 仍是真实条数", async () => {
    mocks.api.mockResolvedValue({ total: 120, items: [] });

    render(<NotificationBadge workspaceId={WID} />);

    const badge = await screen.findByLabelText(badgeLabel(120));
    expect(badge).toHaveTextContent("99+");
  });

  it("点击铃铛打开面板并再次拉取未读（同 URL）", async () => {
    mocks.api.mockResolvedValue({ total: 1, items: [makeItem()] });

    render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(1))).toBeInTheDocument());

    fireEvent.click(bellButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("notifications:loading")).toBeNull());
    expect((mocks.api.mock.calls[1] as [string])[0]).toBe(UNREAD_URL);
    expect(bellButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "notifications:title" })).toBeInTheDocument();
  });

  it("未读项：type 映射 + entityTitle + createdAt，未知 type 原样输出", async () => {
    const createdAt = "2026-10-02T09:30:00.000Z";
    mocks.api.mockResolvedValue({
      total: 3,
      items: [
        makeItem({ id: "n1", type: "mention", entityTitle: "文档甲", createdAt }),
        makeItem({ id: "n2", type: "task_assigned", entityTitle: "任务乙", createdAt }),
        makeItem({ id: "n3", type: "system_alert", entityTitle: "系统丙", createdAt }),
      ],
    });

    const { container } = render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(3))).toBeInTheDocument());

    fireEvent.click(bellButton());
    await waitFor(() => expect(screen.getByText("文档甲")).toBeInTheDocument());

    const text = container.textContent ?? "";
    expect(text).toContain('notifications:mentionText:{"title":""}');
    expect(text).toContain('notifications:assignedText:{"title":""}');
    expect(text).toContain("system_alert");
    expect(text).toContain("任务乙");
    expect(text).toContain(new Date(createdAt).toLocaleString());
    // 头部计数 (3)
    expect(text).toContain("(3)");
  });

  it('加载失败：面板错误分支显示 t("error")，空态文案不再出现', async () => {
    mocks.api.mockRejectedValue(new Error("boom"));

    render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));

    fireEvent.click(bellButton());

    await waitFor(() => expect(screen.getByText("notifications:error")).toBeInTheDocument());
    expect(screen.queryByText("notifications:noUnreadNotifications")).toBeNull();
    // 失败时不应残留徽章
    expect(document.querySelector('span[aria-label^="notifications:unreadCount"]')).toBeNull();
  });

  it("打开面板时先显示 loading 文案，请求返回后消失", async () => {
    let resolveLoad: (value: unknown) => void = () => {};
    mocks.api
      .mockImplementationOnce(() => Promise.resolve({ total: 1, items: [makeItem()] }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          }),
      );

    render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(1))).toBeInTheDocument());

    fireEvent.click(bellButton());
    expect(screen.getByText("notifications:loading")).toBeInTheDocument();

    await act(async () => {
      resolveLoad({ total: 1, items: [makeItem()] });
    });
    expect(screen.queryByText("notifications:loading")).toBeNull();
    expect(screen.getByText("任务甲")).toBeInTheDocument();
  });

  it("单条已读：PATCH method+body 精确，成功后移除该条并减总数", async () => {
    const items = [
      makeItem({ id: "n1", entityTitle: "标题一" }),
      makeItem({ id: "n2", entityTitle: "标题二" }),
    ];
    mocks.api.mockImplementation((url: string) =>
      url.startsWith("/api/v1/notifications/unread")
        ? Promise.resolve({ total: 2, items })
        : Promise.resolve({}),
    );

    const { container } = render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(2))).toBeInTheDocument());

    fireEvent.click(bellButton());
    await waitFor(() => expect(screen.queryByText("notifications:loading")).toBeNull());

    fireEvent.click(screen.getAllByLabelText("notifications:markRead")[0]);

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`/api/v1/notifications/n1?workspaceId=${WID}`, {
        method: "PATCH",
        body: JSON.stringify({ read: true }),
      }),
    );
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(1))).toBeInTheDocument());
    expect(container.textContent).not.toContain("标题一");
    expect(container.textContent).toContain("标题二");
  });

  it('单条已读失败：显示 t("error")，条目与徽章保持原样（被错误分支遮蔽）', async () => {
    const items = [makeItem({ id: "n1", entityTitle: "标题一" })];
    mocks.api.mockImplementation((url: string) =>
      url.startsWith("/api/v1/notifications/unread")
        ? Promise.resolve({ total: 1, items })
        : Promise.reject(new mocks.ApiError("unauthorized", 401, 401)),
    );

    render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(1))).toBeInTheDocument());

    fireEvent.click(bellButton());
    await waitFor(() => expect(screen.queryByText("notifications:loading")).toBeNull());

    fireEvent.click(screen.getAllByLabelText("notifications:markRead")[0]);

    await waitFor(() => expect(screen.getByText("notifications:error")).toBeInTheDocument());
    expect(screen.queryByText("标题一")).toBeNull();
    // 总数未变
    expect(screen.getByLabelText(badgeLabel(1))).toBeInTheDocument();
  });

  it("全部已读：逐条 PATCH，成功后列表清空、徽章消失", async () => {
    const items = [
      makeItem({ id: "n1", entityTitle: "标题一" }),
      makeItem({ id: "n2", entityTitle: "标题二" }),
    ];
    mocks.api.mockImplementation((url: string) =>
      url.startsWith("/api/v1/notifications/unread")
        ? Promise.resolve({ total: 2, items })
        : Promise.resolve({}),
    );

    render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(2))).toBeInTheDocument());

    fireEvent.click(bellButton());
    await waitFor(() => expect(screen.queryByText("notifications:loading")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "notifications:markAllRead" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(`/api/v1/notifications/n1?workspaceId=${WID}`, {
        method: "PATCH",
        body: JSON.stringify({ read: true }),
      }),
    );
    expect(mocks.api).toHaveBeenCalledWith(`/api/v1/notifications/n2?workspaceId=${WID}`, {
      method: "PATCH",
      body: JSON.stringify({ read: true }),
    });
    await waitFor(() =>
      expect(screen.getByText("notifications:noUnreadNotifications")).toBeInTheDocument(),
    );
    expect(document.querySelector('span[aria-label^="notifications:unreadCount"]')).toBeNull();
  });

  it("关闭按钮关闭面板", async () => {
    mocks.api.mockResolvedValue({ total: 1, items: [makeItem()] });

    render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(1))).toBeInTheDocument());

    fireEvent.click(bellButton());
    await waitFor(() => expect(screen.queryByText("notifications:loading")).toBeNull());
    expect(screen.getByRole("dialog", { name: "notifications:title" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "notifications:close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(bellButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("点击面板外遮罩关闭面板", async () => {
    mocks.api.mockResolvedValue({ total: 1, items: [makeItem()] });

    render(<NotificationBadge workspaceId={WID} />);
    await waitFor(() => expect(screen.getByLabelText(badgeLabel(1))).toBeInTheDocument());

    fireEvent.click(bellButton());
    const overlay = document.querySelector("div.fixed.inset-0.z-10");
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay as Element);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
