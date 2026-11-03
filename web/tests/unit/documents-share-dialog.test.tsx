// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

import { ShareDialogEnhanced } from "@/components/documents/ShareDialogEnhanced";

const LIST_PATH = "/api/v1/workspaces/ws-1/documents/doc-1/share-links";

const links = [
  {
    id: "s-1",
    token: "tok-1",
    permission: "edit",
    allowDownload: true,
    allowPrint: false,
    allowCopy: true,
    passwordProtected: true,
    expiresAt: "2099-06-30T12:00:00Z",
    maxViews: 10,
    viewCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "s-2",
    token: "tok-2",
    permission: "view",
    allowDownload: false,
    allowPrint: false,
    allowCopy: false,
    passwordProtected: false,
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "s-3",
    token: "tok-3",
    permission: "comment",
    allowDownload: false,
    allowPrint: true,
    allowCopy: false,
    passwordProtected: false,
    expiresAt: "2000-01-01T00:00:00Z",
    maxViews: null,
    viewCount: 5,
    createdAt: "2026-01-01T00:00:00Z",
  },
];

function bodyOf(call: unknown[]): {
  permission?: string;
  allowDownload?: boolean;
  allowPrint?: boolean;
  allowCopy?: boolean;
  password?: string;
  expiresAt?: string;
  maxViews?: number;
} {
  return JSON.parse((call[1] as { body: string }).body);
}

function defaultApi() {
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (opts?.method === "DELETE" || opts?.method === "POST") return {};
    return { items: links, total: links.length };
  });
}

function listGetCalls() {
  return mocks.api.mock.calls.filter(
    ([p, o]) => p === LIST_PATH && (!o || !o.method || o.method === "GET"),
  );
}

function spansWithClass(container: HTMLElement, token: string) {
  return Array.from(container.querySelectorAll("span")).filter((s) =>
    ((s.className as string) ?? "").includes(token),
  );
}

function renderDialog(onClose?: () => void) {
  return render(<ShareDialogEnhanced workspaceId="ws-1" documentId="doc-1" onClose={onClose} />);
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ShareDialogEnhanced", () => {
  it("加载中显示加载文案", () => {
    defaultApi();
    renderDialog();
    expect(screen.getByText("permissions:loadFailed")).toBeInTheDocument();
  });

  it("空列表显示空态", async () => {
    mocks.api.mockImplementation(async () => ({ items: [], total: 0 }));
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:noShareLinks")).toBeInTheDocument());
  });

  it("ApiError 消息直显且可关闭", async () => {
    mocks.api.mockImplementation(async () => {
      throw new mocks.ApiErrorClass("share-boom");
    });
    renderDialog();
    await waitFor(() => expect(screen.getByText("share-boom")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("permissions:close"));
    await waitFor(() => expect(screen.queryByText("share-boom")).not.toBeInTheDocument());
  });

  it("非 Error 抛出时回退到 loadFailed 文案", async () => {
    mocks.api.mockImplementation(async () => {
      throw "nope";
    });
    renderDialog();
    await waitFor(() =>
      expect(screen.getAllByText("permissions:loadFailed").length).toBeGreaterThanOrEqual(1),
    );
  });

  it("列表渲染：权限标签、开关徽章、访问次数与过期时间", async () => {
    defaultApi();
    const { container } = renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());

    const formatted = new Date("2099-06-30T12:00:00Z").toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(screen.getByText(`permissions:linkExpires: ${formatted}`)).toBeInTheDocument();
    expect(screen.getByText("permissions:maxViews: 3/10")).toBeInTheDocument();
    expect(screen.getByText("permissions:noExpiry")).toBeInTheDocument();

    // 启用的开关徽章 3 枚（s-1 下载/复制、s-3 打印）
    expect(spansWithClass(container, "text-[var(--success)]")).toHaveLength(3);
    // 密码保护徽章仅 1 枚（只有图标，用 class 定位）
    expect(spansWithClass(container, "text-[var(--meta)]")).toHaveLength(1);
    // 已过期徽章仅 1 枚
    expect(spansWithClass(container, "text-[var(--danger)]")).toHaveLength(1);
  });

  it("复制链接成功：写入剪贴板并提示", async () => {
    defaultApi();
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("permissions:copyLink")[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/tok-1`);
    expect(screen.getByText("permissions:linkCopied")).toBeInTheDocument();
  });

  it("复制失败显示失败提示", async () => {
    defaultApi();
    const writeText = vi.fn(() => {
      throw new Error("no clipboard");
    });
    Object.assign(navigator, { clipboard: { writeText } });
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("permissions:copyLink")[0]);
    await waitFor(() => expect(screen.getByText("permissions:copyFailed")).toBeInTheDocument());
  });

  it("复制成功图标 2 秒后复原", async () => {
    defaultApi();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getAllByLabelText("permissions:copyLink")[0]);
      await act(async () => {});
      const btn = screen.getAllByLabelText("permissions:copyLink")[0];
      expect(btn.querySelector("svg")?.getAttribute("class")).toContain("text-[var(--success)]");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      const restored = screen.getAllByLabelText("permissions:copyLink")[0];
      expect(restored.querySelector("svg")?.getAttribute("class") ?? "").not.toContain(
        "text-[var(--success)]",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("撤销链接：确认后 DELETE 并本地移除", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:maxViews: 3/10")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("permissions:actionRevoke")[0]);
    await waitFor(() =>
      expect(screen.queryByText("permissions:maxViews: 3/10")).not.toBeInTheDocument(),
    );
    expect(mocks.api).toHaveBeenCalledWith(`${LIST_PATH}/s-1`, { method: "DELETE" });
    expect(screen.getByText("permissions:shareLinkRevoked")).toBeInTheDocument();
    expect(listGetCalls()).toHaveLength(1);
  });

  it("取消确认不发起撤销请求", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:maxViews: 3/10")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("permissions:actionRevoke")[0]);
    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "DELETE")).toHaveLength(0),
    );
    expect(screen.getByText("permissions:maxViews: 3/10")).toBeInTheDocument();
  });

  it("撤销失败显示错误且列表不变", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") throw new Error("revoke-boom");
      return { items: links, total: links.length };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:maxViews: 3/10")).toBeInTheDocument());

    fireEvent.click(screen.getAllByLabelText("permissions:actionRevoke")[0]);
    await waitFor(() => expect(screen.getByText("revoke-boom")).toBeInTheDocument());
    expect(screen.getByText("permissions:maxViews: 3/10")).toBeInTheDocument();
  });

  it("创建链接全量载荷：权限/开关/密码/过期/次数", async () => {
    defaultApi();
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:createShareLink"));
    fireEvent.click(screen.getByRole("button", { name: "permissions:edit" }));
    fireEvent.click(screen.getByLabelText("permissions:allowDownload"));
    fireEvent.click(screen.getByLabelText("permissions:allowPrint"));
    fireEvent.change(screen.getByLabelText("permissions:passwordProtect"), {
      target: { value: "pw" },
    });
    fireEvent.change(screen.getByLabelText("permissions:linkExpires"), {
      target: { value: "2099-01-01T00:00" },
    });
    fireEvent.change(screen.getByLabelText("permissions:maxViews"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.queryByText("permissions:save")).not.toBeInTheDocument());
    const posts = mocks.api.mock.calls.filter(([p, o]) => p === LIST_PATH && o?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(bodyOf(posts[0])).toEqual({
      permission: "edit",
      allowDownload: true,
      allowPrint: true,
      allowCopy: false,
      password: "pw",
      expiresAt: new Date("2099-01-01T00:00").toISOString(),
      maxViews: 5,
    });
    expect(screen.getByText("permissions:shareLinkCreated")).toBeInTheDocument();
    expect(listGetCalls()).toHaveLength(2);
  });

  it("创建链接最小载荷：仅提交必填键", async () => {
    defaultApi();
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:createShareLink"));
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.queryByText("permissions:save")).not.toBeInTheDocument());
    const posts = mocks.api.mock.calls.filter(([p, o]) => p === LIST_PATH && o?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(bodyOf(posts[0])).toEqual({
      permission: "view",
      allowDownload: false,
      allowPrint: false,
      allowCopy: false,
    });
  });

  it("创建失败保留表单并恢复按钮可用", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "POST") throw new Error("create-boom");
      return { items: links, total: links.length };
    });
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:createShareLink"));
    fireEvent.click(screen.getByRole("button", { name: "permissions:save" }));

    await waitFor(() => expect(screen.getByText("create-boom")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "permissions:save" })).toBeEnabled();
    expect(listGetCalls()).toHaveLength(1);
  });

  it("取消创建重置表单字段（重新打开后为空）", async () => {
    defaultApi();
    renderDialog();
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());

    fireEvent.click(screen.getByText("permissions:createShareLink"));
    fireEvent.click(screen.getByRole("button", { name: "permissions:comment" }));
    fireEvent.click(screen.getByLabelText("permissions:allowDownload"));
    fireEvent.change(screen.getByLabelText("permissions:passwordProtect"), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByText("permissions:cancel"));
    expect(screen.queryByText("permissions:save")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("permissions:createShareLink"));
    expect(screen.getByLabelText("permissions:passwordProtect")).toHaveValue("");
    expect(screen.getByLabelText("permissions:allowDownload")).not.toBeChecked();
  });

  it("传入 onClose 时点击关闭按钮触发回调", async () => {
    defaultApi();
    const onClose = vi.fn();
    renderDialog(onClose);
    await waitFor(() => expect(screen.getByText("permissions:edit")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("permissions:close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
