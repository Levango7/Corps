// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ApprovalSubmit } from "@/components/approval/ApprovalSubmit";

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

const TEMPLATES = "/approvals/templates";
const MEMBERS = "/members";

const TPL_LIST = [
  {
    id: "t-1",
    name: "Budget",
    active: true,
    nodes: [
      { name: "Manager", order: 2, approverRole: "admin" },
      { name: "HR", order: 1 },
    ],
  },
  { id: "t-2", name: "Legacy", active: false, nodes: [] },
];
const MEMBER_LIST = [
  { id: "m-1", name: "Alice", email: "alice@example.com" },
  { id: "m-2", name: null, email: "bob@example.com" },
];

function mockApi(routes: { match: string; data?: unknown; reject?: unknown }[]) {
  apiMock.mockImplementation(async (url: string) => {
    for (const r of routes) {
      if (url.includes(r.match)) {
        if (r.reject) throw r.reject;
        return r.data;
      }
    }
    throw new Error(`unexpected url: ${url}`);
  });
}

function renderModal() {
  const onClose = vi.fn();
  const onSubmitted = vi.fn();
  render(<ApprovalSubmit workspaceId="ws-1" onClose={onClose} onSubmitted={onSubmitted} />);
  return { onClose, onSubmitted };
}

async function renderLoaded(routes: { match: string; data?: unknown; reject?: unknown }[]) {
  mockApi(routes);
  const out = renderModal();
  await act(async () => {});
  return out;
}

function standardRoutes(over: { templates?: unknown; members?: unknown } = {}) {
  return [
    { match: TEMPLATES, data: over.templates ?? TPL_LIST },
    { match: MEMBERS, data: over.members ?? MEMBER_LIST },
  ];
}

const submitButton = () => screen.getByRole("button", { name: "approval:submit" });
const titleInput = () => screen.getByPlaceholderText("approval:title");
const form = () => document.querySelector("form")!;
const INSTANCES_POST = "/api/v1/workspaces/ws-1/approvals/instances";

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

describe("ApprovalSubmit", () => {
  it("loads templates and members, hiding inactive templates", async () => {
    await renderLoaded(standardRoutes());
    expect(screen.getByLabelText("approval:selectTemplate")).not.toBeDisabled();
    expect(screen.getByRole("option", { name: "approval:noTemplate" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Budget" })).toBeInTheDocument();
    // 仅展示 active !== false 的模板
    expect(screen.queryByRole("option", { name: "Legacy" })).not.toBeInTheDocument();
    // 成员兜底：缺 name 时回退邮箱
    expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "bob@example.com" })).toBeInTheDocument();
  });

  it("shows the node preview sorted by order once a template is chosen", async () => {
    await renderLoaded(standardRoutes());
    fireEvent.change(screen.getByLabelText("approval:selectTemplate"), {
      target: { value: "t-1" },
    });
    const lis = [...document.querySelectorAll("ol li")];
    expect(lis.map((li) => li.textContent)).toEqual(["1HR", "2Manager· admin"]);
  });

  it("hides the approver select while a template is chosen", async () => {
    await renderLoaded(standardRoutes());
    expect(screen.getByLabelText("approval:selectApprover")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("approval:selectTemplate"), {
      target: { value: "t-1" },
    });
    expect(screen.queryByLabelText("approval:selectApprover")).not.toBeInTheDocument();
  });

  it("requires a non-empty title before anything else", async () => {
    await renderLoaded(standardRoutes());
    fireEvent.submit(form());
    expect(screen.getByText("approval:titleRequired")).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith(
      expect.stringContaining(INSTANCES_POST),
      expect.anything(),
    );
  });

  it("requires an approver when no template is chosen", async () => {
    await renderLoaded(standardRoutes());
    fireEvent.change(titleInput(), { target: { value: "Budget Q4" } });
    fireEvent.submit(form());
    expect(screen.getByText("approval:approverRequired")).toBeInTheDocument();
  });

  it("submits with templateId and content, omitting default nodes", async () => {
    const { onClose, onSubmitted } = await renderLoaded([
      ...standardRoutes(),
      { match: INSTANCES_POST, data: {} },
    ]);
    fireEvent.change(screen.getByLabelText("approval:selectTemplate"), {
      target: { value: "t-1" },
    });
    fireEvent.change(titleInput(), { target: { value: "Budget Q4" } });
    fireEvent.change(screen.getByLabelText("approval:contentKeyPlaceholder 1"), {
      target: { value: "amount" },
    });
    fireEvent.change(screen.getByLabelText("approval:contentValuePlaceholder 1"), {
      target: { value: "100" },
    });
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith(INSTANCES_POST, {
      method: "POST",
      body: JSON.stringify({ templateId: "t-1", title: "Budget Q4", content: { amount: "100" } }),
    });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("builds a default single-node flow and empty content when no template is chosen", async () => {
    const { onClose, onSubmitted } = await renderLoaded([
      ...standardRoutes(),
      { match: INSTANCES_POST, data: {} },
    ]);
    fireEvent.change(titleInput(), { target: { value: "Ad-hoc request" } });
    fireEvent.change(screen.getByPlaceholderText("approval:description"), {
      target: { value: "extra context" },
    });
    fireEvent.change(screen.getByLabelText("approval:selectApprover"), {
      target: { value: "m-1" },
    });
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith(INSTANCES_POST, {
      method: "POST",
      body: JSON.stringify({
        title: "Ad-hoc request",
        description: "extra context",
        // content 必须是 record：空内容给 {}（给 "" 会被后端 z.record 判 400）
        content: {},
        // 节点三要素：name + approverUserId（单数，后端只认这个）+ order（必填）
        nodes: [{ name: "approval:approver", approverUserId: "m-1", order: 0 }],
      }),
    });
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("adds and removes content rows but always keeps one", async () => {
    await renderLoaded(standardRoutes());
    const keyInputs = () => screen.getAllByLabelText(/approval:contentKeyPlaceholder/);
    expect(keyInputs()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "approval:addContentField" }));
    expect(keyInputs()).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("approval:delete")[0]);
    expect(keyInputs()).toHaveLength(1);
    // 删除最后一行时重置为一行空字段，而不是清空
    fireEvent.click(screen.getAllByLabelText("approval:delete")[0]);
    expect(keyInputs()).toHaveLength(1);
    expect(keyInputs()[0]).toHaveValue("");
  });

  it("keeps only non-empty keys in the submitted content object", async () => {
    await renderLoaded(standardRoutes());
    fireEvent.change(screen.getByLabelText("approval:selectTemplate"), {
      target: { value: "t-1" },
    });
    fireEvent.change(titleInput(), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("approval:contentKeyPlaceholder 1"), {
      target: { value: "amount" },
    });
    fireEvent.click(screen.getByRole("button", { name: "approval:addContentField" }));
    fireEvent.change(screen.getByLabelText("approval:contentKeyPlaceholder 2"), {
      target: { value: "  spaced " },
    });
    fireEvent.change(screen.getByLabelText("approval:contentValuePlaceholder 2"), {
      target: { value: "v" },
    });
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(apiMock).toHaveBeenCalledWith(INSTANCES_POST, {
      method: "POST",
      body: JSON.stringify({
        templateId: "t-1",
        title: "T",
        content: { amount: "", spaced: "v" },
      }),
    });
  });

  it("surfaces ApiError messages on submit failure and keeps the modal open", async () => {
    const { onClose, onSubmitted } = await renderLoaded([
      { match: TEMPLATES, data: TPL_LIST },
      { match: MEMBERS, data: MEMBER_LIST },
      { match: INSTANCES_POST, reject: new ApiErrorMock("boom-submit") },
    ]);
    fireEvent.change(titleInput(), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("approval:selectApprover"), {
      target: { value: "m-1" },
    });
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(screen.getByText("boom-submit")).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to the i18n submit-failed copy for non-Error rejections", async () => {
    await renderLoaded([
      { match: TEMPLATES, data: TPL_LIST },
      { match: MEMBERS, data: MEMBER_LIST },
      { match: INSTANCES_POST, reject: "nope" },
    ]);
    fireEvent.change(titleInput(), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("approval:selectApprover"), {
      target: { value: "m-1" },
    });
    fireEvent.click(submitButton());
    await act(async () => {});
    expect(screen.getByText("approval:submitFailed")).toBeInTheDocument();
    // 横幅里的关闭按钮可清除错误（与头部关闭按钮同名，按横幅定位）
    const banner = document.querySelector('div[class*="danger-soft"]')!;
    fireEvent.click(banner.querySelector("button")!);
    expect(screen.queryByText("approval:submitFailed")).not.toBeInTheDocument();
  });

  it("swallows template loading failures and keeps the form usable", async () => {
    // 模板加载失败时不阻塞表单（Promise.all 整体失败，成员也拿不到）
    await renderLoaded([
      { match: TEMPLATES, reject: new Error("tpl-down") },
      { match: MEMBERS, data: MEMBER_LIST },
    ]);
    expect(screen.getByLabelText("approval:selectTemplate")).not.toBeDisabled();
    expect(screen.queryByRole("option", { name: "Budget" })).not.toBeInTheDocument();
    expect(screen.queryByText("tpl-down")).not.toBeInTheDocument();
  });

  it("swallows member loading failures without blocking templates", async () => {
    await renderLoaded([
      { match: TEMPLATES, data: TPL_LIST },
      { match: MEMBERS, reject: new Error("mem-down") },
    ]);
    expect(screen.getByRole("option", { name: "Budget" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alice" })).not.toBeInTheDocument();
  });

  it("disables the submit button until a title and a template or approver are set", async () => {
    await renderLoaded(standardRoutes());
    expect(submitButton()).toBeDisabled();
    fireEvent.change(titleInput(), { target: { value: "T" } });
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("approval:selectApprover"), {
      target: { value: "m-1" },
    });
    expect(submitButton()).toBeEnabled();
  });

  it("closes on ESC", async () => {
    const { onClose } = await renderLoaded(standardRoutes());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click but not on clicks inside the dialog", async () => {
    const { onClose } = await renderLoaded(standardRoutes());
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the cancel and header close buttons", async () => {
    const { onClose } = await renderLoaded(standardRoutes());
    fireEvent.click(screen.getByRole("button", { name: "button:cancel" }));
    fireEvent.click(screen.getAllByLabelText("button:close")[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
