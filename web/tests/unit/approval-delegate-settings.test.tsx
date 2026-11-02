// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { ApprovalDelegateSettings } from "@/components/approval/ApprovalDelegateSettings";

const { apiMock, ApiErrorMock } = vi.hoisted(() => {
  class ApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { apiMock: vi.fn(), ApiErrorMock: ApiError };
});

vi.mock("@/lib/api", () => ({ api: apiMock, ApiError: ApiErrorMock }));

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

const DELEGATES_GET = "/api/v1/workspaces/ws-1/approvals/delegates?page=1&limit=20&active=1";
const MEMBERS = "/api/v1/workspaces/ws-1/members";
const DELEGATES_POST = "/api/v1/workspaces/ws-1/approvals/delegates";

const MEMBER_LIST = [
  { id: "m-1", name: "Alice", email: "alice@example.com" },
  { id: "m-2", name: null, email: "bob@example.com" },
];

interface DelegateFixture {
  id: string;
  workspaceId: string;
  delegatorId: string;
  delegateToId: string;
  startAt: string;
  endAt: string;
  reason?: string | null;
  active: boolean;
  createdAt: string;
  delegateTo: { id: string; name: string; email: string };
}

function mkDelegate(over: Partial<DelegateFixture> = {}): DelegateFixture {
  return {
    id: "d-1",
    workspaceId: "ws-1",
    delegatorId: "u-me",
    delegateToId: "m-1",
    startAt: "2026-11-02T09:00:00Z",
    endAt: "2099-12-31T23:59:00Z",
    reason: null,
    active: true,
    createdAt: "2026-11-01T08:00:00Z",
    delegateTo: { id: "m-1", name: "Alice", email: "alice@example.com" },
    ...over,
  };
}

const ACTIVE = mkDelegate();
const EXPIRED = mkDelegate({
  id: "d-2",
  endAt: "2026-10-01T00:00:00Z",
  reason: "Vacation cover",
  delegateTo: { id: "m-2", name: "Bob", email: "bob@example.com" },
});

function envelope(items: DelegateFixture[]) {
  return { items, total: items.length, page: 1, limit: 20, totalPages: 1 };
}

interface MockOpts {
  delegates?: unknown;
  delegatesError?: unknown;
  members?: unknown;
  membersError?: unknown;
  postError?: unknown;
  onPost?: (url: string, body?: string) => void;
  /** 第二次（提交后重载）返回的委托列表 */
  reload?: unknown;
}

function mockApi(opts: MockOpts = {}) {
  let delegatesServed = false;
  apiMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === MEMBERS) {
      if (opts.membersError) throw opts.membersError;
      return opts.members ?? MEMBER_LIST;
    }
    if (init?.method === "DELETE") return {};
    if (init?.method === "POST") {
      if (opts.postError) throw opts.postError;
      opts.onPost?.(url, init.body);
      return {};
    }
    if (url === DELEGATES_GET) {
      if (opts.delegatesError) throw opts.delegatesError;
      // 提交成功后组件会重载列表，第二次返回 reload（若提供）
      if (!delegatesServed && opts.reload !== undefined) {
        delegatesServed = true;
        return opts.delegates ?? envelope([ACTIVE, EXPIRED]);
      }
      return opts.reload ?? opts.delegates ?? envelope([ACTIVE, EXPIRED]);
    }
    throw new Error(`unexpected url: ${url}`);
  });
}

async function renderLoaded(opts: MockOpts = {}) {
  mockApi(opts);
  render(<ApprovalDelegateSettings workspaceId="ws-1" />);
  await act(async () => {});
}

const toggleFormButton = () => screen.getByRole("button", { name: "approval:delegate" });

/** 表单错误横幅内的文本（placeholder 选项与会与错误文本撞名，故按容器取） */
const formError = () =>
  document.querySelector<HTMLSpanElement>('div[class*="danger-soft"] > span')?.textContent ?? "";

describe("ApprovalDelegateSettings", () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders the loading state before data lands", () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    render(<ApprovalDelegateSettings workspaceId="ws-1" />);
    expect(screen.getByText("approval:loading")).toBeInTheDocument();
  });

  it("renders active and expired delegates with name, times and reason", async () => {
    await renderLoaded();
    // 列表项 1：生效中
    const activeItem = screen.getByText("Alice").closest("li")!;
    expect(within(activeItem).getByText("approval:delegateActive")).toBeInTheDocument();
    // 列表项 2：已过期且带原因
    const expiredItem = screen.getByText("Bob").closest("li")!;
    expect(within(expiredItem).getByText("approval:delegateExpired")).toBeInTheDocument();
    expect(
      within(expiredItem).getByText(/approval:delegateReason: Vacation cover/),
    ).toBeInTheDocument();
    // 起止时间标签
    expect(screen.getAllByText(/approval:delegateStartAt:/).length).toBe(2);
    expect(screen.getAllByText(/approval:delegateEndAt:/).length).toBe(2);
  });

  it("falls back to the delegate email when the name is missing", async () => {
    await renderLoaded({
      delegates: envelope([
        mkDelegate({ delegateTo: { id: "m-9", name: "", email: "nomail@example.com" } }),
      ]),
    });
    expect(screen.getByText("nomail@example.com")).toBeInTheDocument();
  });

  it("shows the empty state when there are no delegates", async () => {
    await renderLoaded({ delegates: envelope([]) });
    expect(screen.getByText("approval:noDelegates")).toBeInTheDocument();
  });

  it("renders the member picker from a bare members array, falling back to email", async () => {
    await renderLoaded({ members: MEMBER_LIST });
    fireEvent.click(toggleFormButton());
    const select = document.querySelector<HTMLSelectElement>("#delegate-to")!;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "approval:selectUser",
      "Alice",
      "bob@example.com",
    ]);
  });

  it("accepts an envelope from the delegates API", async () => {
    await renderLoaded({ delegates: envelope([ACTIVE]) });
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("surfaces the ApiError message and the i18n fallback for other rejections", async () => {
    await renderLoaded({ delegatesError: new ApiErrorMock("boom-load") });
    expect(screen.getByText("boom-load")).toBeInTheDocument();
    await renderLoaded({ delegatesError: "nope" });
    expect(screen.getByText("approval:loadFailed")).toBeInTheDocument();
  });

  it("does not block the list when the members request fails", async () => {
    await renderLoaded({ membersError: new ApiErrorMock("no-members") });
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("no-members")).not.toBeInTheDocument();
  });

  it("revokes a delegate after confirm and removes it from the list", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderLoaded();
    const item = screen.getByText("Bob").closest("li")!;
    fireEvent.click(within(item).getByRole("button", { name: "approval:cancel" }));
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/approvals/delegates/d-2", {
      method: "DELETE",
    });
    expect(confirmSpy).toHaveBeenCalledWith("approval:confirmDelegate");
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("skips the DELETE when the confirm dialog is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderLoaded();
    const item = screen.getByText("Alice").closest("li")!;
    fireEvent.click(within(item).getByRole("button", { name: "approval:cancel" }));
    await act(async () => {});
    expect(apiMock).not.toHaveBeenCalledWith("/api/v1/workspaces/ws-1/approvals/delegates/d-1", {
      method: "DELETE",
    });
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("keeps the delegate and shows the error when the DELETE fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let deleteUrl = "";
    apiMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") {
        deleteUrl = url;
        throw new ApiErrorMock("boom-delete");
      }
      return url === DELEGATES_GET ? envelope([ACTIVE]) : [];
    });
    render(<ApprovalDelegateSettings workspaceId="ws-1" />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "approval:cancel" }));
    await act(async () => {});
    expect(deleteUrl).toBe("/api/v1/workspaces/ws-1/approvals/delegates/d-1");
    expect(screen.getByText("boom-delete")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("requires selecting a delegate before submitting the form", async () => {
    await renderLoaded();
    fireEvent.click(toggleFormButton());
    fireEvent.submit(document.querySelector("form")!);
    expect(formError()).toBe("approval:selectUser");
  });

  it("requires both start and end times", async () => {
    await renderLoaded();
    fireEvent.click(toggleFormButton());
    fireEvent.change(document.querySelector<HTMLSelectElement>("#delegate-to")!, {
      target: { value: "m-1" },
    });
    fireEvent.submit(document.querySelector("form")!);
    expect(formError()).toBe("approval:delegateStartAt / approval:delegateEndAt");
  });

  it("rejects an end time that is not after the start time", async () => {
    await renderLoaded();
    fireEvent.click(toggleFormButton());
    fireEvent.change(document.querySelector<HTMLSelectElement>("#delegate-to")!, {
      target: { value: "m-1" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("#delegate-start")!, {
      target: { value: "2026-11-02T12:00" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("#delegate-end")!, {
      target: { value: "2026-11-02T09:00" },
    });
    fireEvent.submit(document.querySelector("form")!);
    expect(formError()).toBe("approval:delegateEndAt");
  });

  it("creates a delegate and reloads the list, then closes the form", async () => {
    const posted: Array<[string, string | undefined]> = [];
    await renderLoaded({
      onPost: (url, body) => posted.push([url, body]),
      reload: envelope([ACTIVE, mkDelegate({ id: "d-new", delegateToId: "m-2" })]),
    });
    fireEvent.click(toggleFormButton());
    fireEvent.change(document.querySelector<HTMLSelectElement>("#delegate-to")!, {
      target: { value: "m-2" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("#delegate-start")!, {
      target: { value: "2026-11-02T09:00" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("#delegate-end")!, {
      target: { value: "2026-11-03T18:00" },
    });
    fireEvent.submit(document.querySelector("form")!);
    await act(async () => {});
    // startAt/endAt 按 datetime-local 本地时间转 ISO，与组件内 toISO 同口径计算
    expect(posted).toEqual([
      [
        DELEGATES_POST,
        JSON.stringify({
          delegateToId: "m-2",
          startAt: new Date("2026-11-02T09:00").toISOString(),
          endAt: new Date("2026-11-03T18:00").toISOString(),
          reason: undefined,
        }),
      ],
    ]);
    // 表单关闭、重载后出现新委托，旧过期项保留
    expect(document.querySelector("#delegate-to")).not.toBeInTheDocument();
    expect(screen.getAllByText("approval:delegateActive").length).toBe(2);
  });

  it("trims the reason before posting and clears it after success", async () => {
    const posted: Array<string | undefined> = [];
    await renderLoaded({
      onPost: (_url, body) => posted.push(body),
      reload: envelope([ACTIVE]),
    });
    fireEvent.click(toggleFormButton());
    fireEvent.change(document.querySelector<HTMLSelectElement>("#delegate-to")!, {
      target: { value: "m-1" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("#delegate-start")!, {
      target: { value: "2026-11-02T09:00" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("#delegate-end")!, {
      target: { value: "2026-11-03T18:00" },
    });
    fireEvent.change(document.querySelector<HTMLTextAreaElement>("#delegate-reason")!, {
      target: { value: "  Out of office  " },
    });
    fireEvent.submit(document.querySelector("form")!);
    await act(async () => {});
    expect(JSON.parse(posted[0]!).reason).toBe("Out of office");
    // 成功后表单字段重置：再次打开时原因框为空
    fireEvent.click(toggleFormButton());
    expect(document.querySelector<HTMLTextAreaElement>("#delegate-reason")!.value).toBe("");
  });

  it("keeps the form open with the failure message when the POST is rejected", async () => {
    await renderLoaded({ postError: new ApiErrorMock("boom-submit") });
    fireEvent.click(toggleFormButton());
    fireEvent.change(document.querySelector<HTMLSelectElement>("#delegate-to")!, {
      target: { value: "m-1" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("#delegate-start")!, {
      target: { value: "2026-11-02T09:00" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("#delegate-end")!, {
      target: { value: "2026-11-03T18:00" },
    });
    fireEvent.submit(document.querySelector("form")!);
    await act(async () => {});
    expect(screen.getByText("boom-submit")).toBeInTheDocument();
    expect(document.querySelector("#delegate-to")).toBeInTheDocument();
  });

  it("closes the form and clears its error via the cancel button", async () => {
    await renderLoaded();
    fireEvent.click(toggleFormButton());
    fireEvent.submit(document.querySelector("form")!);
    expect(formError()).toBe("approval:selectUser");
    fireEvent.click(
      within(document.querySelector("form")!).getByRole("button", { name: "approval:cancel" }),
    );
    expect(document.querySelector("#delegate-to")).not.toBeInTheDocument();
    // 再次打开：错误已被清空
    fireEvent.click(toggleFormButton());
    expect(document.querySelector('div[class*="danger-soft"]')).not.toBeInTheDocument();
  });
});
