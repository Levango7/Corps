// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { ApprovalTemplateManage } from "@/components/approval/ApprovalTemplateManage";

const { apiMock, apiListMock, ApiErrorMock } = vi.hoisted(() => {
  class ApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return { apiMock: vi.fn(), apiListMock: vi.fn(), ApiErrorMock: ApiError };
});

vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: ApiErrorMock,
  apiList: apiListMock,
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

const TEMPLATES = "/api/v1/workspaces/ws-1/approvals/templates";
const MEMBERS = "/api/v1/workspaces/ws-1/members";

const MEMBER_LIST = [
  { id: "m-1", name: "Alice", email: "alice@example.com" },
  { id: "m-2", name: null, email: "bob@example.com" },
];

interface TemplateFixture {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean;
  nodes?: Array<{
    name: string;
    order: number;
    approverRole?: string | null;
    approverUserId?: string | null;
  }> | null;
}

function mkTemplate(over: Partial<TemplateFixture> = {}): TemplateFixture {
  return {
    id: "t-1",
    name: "Budget",
    description: "Quarterly budget approval",
    active: true,
    nodes: [{ name: "Manager", order: 1, approverRole: "admin" }],
    ...over,
  };
}

const BUDGET = mkTemplate();
const LEGACY = mkTemplate({
  id: "t-2",
  name: "Legacy",
  description: null,
  active: false,
  nodes: [
    { name: "Manager", order: 2, approverRole: "admin" },
    { name: "HR", order: 1 },
  ],
});

function envelope(items: TemplateFixture[]) {
  return { items, total: items.length, page: 1, limit: 20, totalPages: 1 };
}

interface MockOpts {
  templates?: unknown;
  templatesError?: unknown;
  members?: unknown;
  membersError?: unknown;
  patchError?: unknown;
  onPatch?: (url: string, body?: string) => void;
  deleteError?: unknown;
  onDelete?: (url: string) => void;
  postError?: unknown;
  onPost?: (url: string, body?: string) => void;
  /** 保存成功后重载（第二次 GET）返回的模板列表 */
  reload?: unknown;
}

function mockApi(opts: MockOpts = {}) {
  let templatesServed = false;
  apiMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "DELETE") {
      if (opts.deleteError) throw opts.deleteError;
      opts.onDelete?.(url);
      return {};
    }
    if (init?.method === "PATCH") {
      if (opts.patchError) throw opts.patchError;
      opts.onPatch?.(url, init.body);
      return {};
    }
    if (init?.method === "POST") {
      if (opts.postError) throw opts.postError;
      opts.onPost?.(url, init.body);
      return {};
    }
    if (url === TEMPLATES) {
      if (opts.templatesError) throw opts.templatesError;
      if (!templatesServed && opts.reload !== undefined) {
        templatesServed = true;
        return opts.templates ?? envelope([BUDGET, LEGACY]);
      }
      return opts.reload ?? opts.templates ?? envelope([BUDGET, LEGACY]);
    }
    throw new Error(`unexpected url: ${url}`);
  });
  apiListMock.mockImplementation(async (url: string) => {
    if (url === MEMBERS) {
      if (opts.membersError) throw opts.membersError;
      return opts.members ?? MEMBER_LIST;
    }
    throw new Error(`unexpected apiList url: ${url}`);
  });
}

async function renderLoaded(opts: MockOpts = {}) {
  mockApi(opts);
  render(<ApprovalTemplateManage workspaceId="ws-1" />);
  await act(async () => {});
}

/** 列表项按名称定位 */
const rowOf = (name: string) => screen.getByText(name).closest("li")!;

/** 弹窗内按 DOM 顺序读取节点名称输入框的值 */
const nodeNames = () =>
  [...document.querySelectorAll<HTMLInputElement>('input[aria-label^="approval:nodeName"]')].map(
    (input) => input.value,
  );

/** 节点行的上移/下移按钮（DOM 顺序：先上后下） */
const moveButtons = (row: HTMLElement) =>
  within(row).getAllByRole("button", { name: "approval:nodeOrder" });

describe("ApprovalTemplateManage", () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    apiListMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders the loading state before data lands", () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    apiListMock.mockImplementation(() => new Promise(() => {}));
    render(<ApprovalTemplateManage workspaceId="ws-1" />);
    expect(screen.getByText("approval:loading")).toBeInTheDocument();
  });

  it("renders the template list with badges, descriptions and node counts", async () => {
    await renderLoaded();
    // 启用模板
    const budget = rowOf("Budget");
    expect(within(budget).getByText("approval:templateEnabled")).toBeInTheDocument();
    expect(within(budget).getByText("Quarterly budget approval")).toBeInTheDocument();
    expect(within(budget).getByText("approval:nodes: 1")).toBeInTheDocument();
    expect(within(budget).getByRole("button", { name: "approval:disable" })).toBeInTheDocument();
    // 禁用模板（无描述）
    const legacy = rowOf("Legacy");
    expect(within(legacy).getByText("approval:templateDisabled")).toBeInTheDocument();
    expect(within(legacy).queryByText("approval:nodes: 2")).toBeInTheDocument();
    expect(within(legacy).getByRole("button", { name: "approval:enable" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no templates and accepts an envelope", async () => {
    await renderLoaded({ templates: envelope([]) });
    expect(screen.getByText("approval:templateEmpty")).toBeInTheDocument();
  });

  it("surfaces the ApiError message and the i18n fallback for other load rejections", async () => {
    await renderLoaded({ templatesError: new ApiErrorMock("boom-load") });
    expect(screen.getByText("boom-load")).toBeInTheDocument();
    await renderLoaded({ templatesError: "nope" });
    expect(screen.getByText("approval:loadFailed")).toBeInTheDocument();
  });

  it("does not block the list when the members request fails", async () => {
    await renderLoaded({ membersError: new ApiErrorMock("no-members") });
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.queryByText("no-members")).not.toBeInTheDocument();
  });

  it("toggles a template off and on via PATCH without a reload", async () => {
    const patched: Array<[string, string | undefined]> = [];
    const reloaded: string[] = [];
    apiMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PATCH") {
        patched.push([url, init.body]);
        return {};
      }
      if (url === TEMPLATES) {
        reloaded.push(url);
        return envelope([BUDGET, LEGACY]);
      }
      throw new Error(`unexpected url: ${url}`);
    });
    apiListMock.mockResolvedValue(MEMBER_LIST);
    render(<ApprovalTemplateManage workspaceId="ws-1" />);
    await act(async () => {});
    const before = reloaded.length;
    fireEvent.click(within(rowOf("Budget")).getByRole("button", { name: "approval:disable" }));
    await act(async () => {});
    expect(patched).toEqual([[`${TEMPLATES}/t-1`, JSON.stringify({ active: false })]]);
    // 就地更新：列表未重载，徽标已变
    expect(reloaded.length).toBe(before);
    expect(within(rowOf("Budget")).getByText("approval:templateDisabled")).toBeInTheDocument();
  });

  it("shows the error when the PATCH fails", async () => {
    await renderLoaded({ patchError: new ApiErrorMock("boom-patch") });
    fireEvent.click(within(rowOf("Budget")).getByRole("button", { name: "approval:disable" }));
    await act(async () => {});
    expect(screen.getByText("boom-patch")).toBeInTheDocument();
    expect(within(rowOf("Budget")).getByText("approval:templateEnabled")).toBeInTheDocument();
  });

  it("deletes a template after confirm and removes it from the list", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const deleted: string[] = [];
    await renderLoaded({ onDelete: (url) => deleted.push(url) });
    fireEvent.click(within(rowOf("Legacy")).getByRole("button", { name: "approval:delete" }));
    await act(async () => {});
    expect(confirmSpy).toHaveBeenCalledWith("approval:confirmDeleteTemplate");
    expect(deleted).toEqual([`${TEMPLATES}/t-2`]);
    expect(screen.queryByText("Legacy")).not.toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
  });

  it("skips the DELETE when the confirm dialog is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const deleted: string[] = [];
    await renderLoaded({ onDelete: (url) => deleted.push(url) });
    fireEvent.click(within(rowOf("Legacy")).getByRole("button", { name: "approval:delete" }));
    await act(async () => {});
    expect(deleted).toEqual([]);
    expect(screen.getByText("Legacy")).toBeInTheDocument();
  });

  it("keeps the template and shows the error when the DELETE fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderLoaded({
      deleteError: new ApiErrorMock("boom-delete"),
      templates: envelope([BUDGET]),
    });
    fireEvent.click(within(rowOf("Budget")).getByRole("button", { name: "approval:delete" }));
    await act(async () => {});
    expect(screen.getByText("boom-delete")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
  });

  it("prefills the edit dialog and sorts nodes by order", async () => {
    await renderLoaded();
    fireEvent.click(within(rowOf("Legacy")).getByRole("button", { name: "approval:edit" }));
    expect(screen.getByText("approval:editTemplate")).toBeInTheDocument();
    expect(document.querySelector<HTMLInputElement>("#tpl-name")!.value).toBe("Legacy");
    expect(document.querySelector<HTMLTextAreaElement>("#tpl-desc")!.value).toBe("");
    // Legacy 节点存储顺序为 [Manager(order 2), HR(order 1)]，弹窗按 order 升序
    expect(nodeNames()).toEqual(["HR", "Manager"]);
    // 第一个节点可上移被禁用、最后一个节点可下移被禁用
    const rows = [
      ...document.querySelectorAll<HTMLInputElement>('input[aria-label^="approval:nodeName"]'),
    ].map((input) => input.closest('div[class*="surface-2"]') as HTMLElement);
    expect(moveButtons(rows[0])[0]).toBeDisabled();
    expect(moveButtons(rows[rows.length - 1])[1]).toBeDisabled();
  });

  it("starts the create dialog with a single empty node row", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    // 标题与会提交按钮文案相同，按 heading 角色定位
    expect(screen.getByRole("heading", { name: "approval:createTemplate" })).toBeInTheDocument();
    expect(nodeNames()).toEqual([""]);
    expect(document.querySelectorAll<HTMLSelectElement>("form select").length).toBe(1);
  });

  it("requires a template name", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#tpl-name")!, {
      target: { value: "  " },
    });
    fireEvent.submit(document.querySelector("form")!);
    expect(
      document.querySelector<HTMLSpanElement>('div[class*="danger-soft"] > span')?.textContent,
    ).toBe("approval:templateNameRequired");
  });

  it("requires at least one named node", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#tpl-name")!, {
      target: { value: "Travel" },
    });
    fireEvent.submit(document.querySelector("form")!);
    expect(
      document.querySelector<HTMLSpanElement>('div[class*="danger-soft"] > span')?.textContent,
    ).toBe("approval:nodeRequired");
  });

  it("requires every named node to declare an approver role or user", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#tpl-name")!, {
      target: { value: "Travel" },
    });
    const nameInputs = document.querySelectorAll<HTMLInputElement>(
      'input[aria-label^="approval:nodeName"]',
    );
    fireEvent.change(nameInputs[0], { target: { value: "Manager" } });
    fireEvent.submit(document.querySelector("form")!);
    expect(
      document.querySelector<HTMLSpanElement>('div[class*="danger-soft"] > span')?.textContent,
    ).toBe("approval:approverRequired");
  });

  it("patches an edited template with mapped nodes, trimmed fields and dropped empty nodes", async () => {
    const patched: Array<[string, string | undefined]> = [];
    await renderLoaded({
      onPatch: (url, body) => patched.push([url, body]),
      reload: envelope([
        mkTemplate({ id: "t-2", name: "Legacy v2", description: "desc", nodes: [] }),
      ]),
    });
    fireEvent.click(within(rowOf("Legacy")).getByRole("button", { name: "approval:edit" }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#tpl-name")!, {
      target: { value: " Legacy v2 " },
    });
    fireEvent.change(document.querySelector<HTMLTextAreaElement>("#tpl-desc")!, {
      target: { value: "  desc  " },
    });
    const rows = [
      ...document.querySelectorAll<HTMLInputElement>('input[aria-label^="approval:nodeName"]'),
    ].map((input) => input.closest('div[class*="surface-2"]') as HTMLElement);
    // 第一个节点（HR）：给角色；第二个节点（Manager）：清掉角色并指定用户
    fireEvent.change(within(rows[0]).getByLabelText("approval:approverRole 1"), {
      target: { value: "hr" },
    });
    fireEvent.change(within(rows[1]).getByLabelText("approval:approverRole 2"), {
      target: { value: "" },
    });
    fireEvent.change(rows[1].querySelector<HTMLSelectElement>("select")!, {
      target: { value: "m-1" },
    });
    // 再加一个不填名称的节点，提交时应被丢弃
    fireEvent.click(screen.getByRole("button", { name: "approval:addNode" }));
    fireEvent.submit(document.querySelector("form")!);
    await act(async () => {});
    expect(patched).toEqual([
      [
        `${TEMPLATES}/t-2`,
        JSON.stringify({
          name: "Legacy v2",
          description: "desc",
          nodes: [
            { name: "HR", order: 1, approverRole: "hr", approverUserId: null },
            { name: "Manager", order: 2, approverRole: null, approverUserId: "m-1" },
          ],
        }),
      ],
    ]);
    // 保存成功后弹窗关闭并重载列表
    expect(screen.queryByText("approval:editTemplate")).not.toBeInTheDocument();
    expect(screen.getByText("Legacy v2")).toBeInTheDocument();
  });

  it("creates a template via POST, then closes the dialog and reloads", async () => {
    const posted: Array<[string, string | undefined]> = [];
    await renderLoaded({
      onPost: (url, body) => posted.push([url, body]),
      reload: envelope([BUDGET, mkTemplate({ id: "t-new", name: "Travel", nodes: [] })]),
    });
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#tpl-name")!, {
      target: { value: "Travel" },
    });
    fireEvent.change(document.querySelector<HTMLTextAreaElement>("#tpl-desc")!, {
      target: { value: "  " },
    });
    const nameInput = document.querySelector<HTMLInputElement>(
      'input[aria-label^="approval:nodeName"]',
    )!;
    fireEvent.change(nameInput, { target: { value: "Lead" } });
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[aria-label^="approval:approverRole"]')!,
      { target: { value: "lead" } },
    );
    fireEvent.submit(document.querySelector("form")!);
    await act(async () => {});
    expect(posted).toEqual([
      [
        TEMPLATES,
        JSON.stringify({
          name: "Travel",
          description: null,
          nodes: [{ name: "Lead", order: 1, approverRole: "lead", approverUserId: null }],
        }),
      ],
    ]);
    expect(screen.queryByText("approval:createTemplate")).not.toBeInTheDocument();
    expect(screen.getByText("Travel")).toBeInTheDocument();
  });

  it("keeps the dialog open with the error when saving is rejected", async () => {
    await renderLoaded({ postError: new ApiErrorMock("boom-save") });
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    fireEvent.change(document.querySelector<HTMLInputElement>("#tpl-name")!, {
      target: { value: "Travel" },
    });
    const nameInput = document.querySelector<HTMLInputElement>(
      'input[aria-label^="approval:nodeName"]',
    )!;
    fireEvent.change(nameInput, { target: { value: "Lead" } });
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[aria-label^="approval:approverRole"]')!,
      { target: { value: "lead" } },
    );
    fireEvent.submit(document.querySelector("form")!);
    await act(async () => {});
    expect(screen.getByText("boom-save")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "approval:createTemplate" })).toBeInTheDocument();
    // 错误横幅可单独关闭
    fireEvent.click(
      within(document.querySelector('div[class*="danger-soft"]')!).getByRole("button", {
        name: "button:close",
      }),
    );
    expect(screen.queryByText("boom-save")).not.toBeInTheDocument();
  });

  it("adds, reorders and removes nodes while always keeping at least one", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    const nameInputs = () =>
      document.querySelectorAll<HTMLInputElement>('input[aria-label^="approval:nodeName"]');
    const lastRow = () =>
      nameInputs()[nameInputs().length - 1].closest('div[class*="surface-2"]') as HTMLElement;
    // 填好第一个节点并新增第二个
    fireEvent.change(nameInputs()[0], { target: { value: "First" } });
    fireEvent.change(
      lastRow().querySelector<HTMLInputElement>('input[aria-label^="approval:approverRole"]')!,
      { target: { value: "admin" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "approval:addNode" }));
    expect(nodeNames()).toEqual(["First", ""]);
    // 把第二个节点上移到第一位
    fireEvent.click(moveButtons(lastRow())[0]);
    expect(nodeNames()).toEqual(["", "First"]);
    // 下移越界被禁止：第一位节点的下移按钮可用，但把第一位再上移无效
    const firstRow = () => nameInputs()[0].closest('div[class*="surface-2"]') as HTMLElement;
    fireEvent.click(moveButtons(firstRow())[0]);
    expect(nodeNames()).toEqual(["", "First"]);
    // 删除空节点（此时位于第一行）后仍保留一行
    fireEvent.click(within(firstRow()).getByRole("button", { name: "approval:delete" }));
    expect(nodeNames()).toEqual(["First"]);
    // 仅剩一行时再点删除应重置为一个新的空行
    fireEvent.click(within(firstRow()).getByRole("button", { name: "approval:delete" }));
    expect(nodeNames()).toEqual([""]);
  });

  it("dismisses the dialog on ESC and backdrop click, keeping inner clicks open", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    // 点击对话框内容层不应关闭
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // ESC 关闭
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 再次打开后点击遮罩层自身关闭
    fireEvent.click(screen.getByRole("button", { name: "approval:addTemplate" }));
    fireEvent.click(screen.getByRole("presentation"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
