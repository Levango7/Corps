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

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));

vi.mock("@/components/form/FormBuilder", () => ({
  FormBuilder: (props: {
    wid: string;
    form: { id: string } | null;
    onSaved: (form: { id: string; title?: string }) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="form-builder">
      <span data-testid="fb-wid">{props.wid}</span>
      <span data-testid="fb-form-id">{props.form ? props.form.id : "new"}</span>
      <button type="button" onClick={() => props.onSaved({ id: "f-9", title: "Created" })}>
        SAVE_NEW
      </button>
      <button type="button" onClick={() => props.onSaved({ id: "f-1", title: "Updated" })}>
        SAVE_UPDATE
      </button>
      <button type="button" onClick={props.onCancel}>
        BUILDER_CANCEL
      </button>
    </div>
  ),
}));

vi.mock("@/components/form/FormPreview", () => ({
  FormPreview: (props: { wid: string; form: { id: string }; onSubmitSuccess?: () => void }) => (
    <div data-testid="form-preview">
      <span data-testid="fp-form-id">{props.form.id}</span>
      <button type="button" onClick={() => props.onSubmitSuccess?.()}>
        PREVIEW_SUBMIT
      </button>
    </div>
  ),
}));

vi.mock("@/components/form/FormSubmissionList", () => ({
  FormSubmissionList: (props: { wid: string; form: { id: string }; refreshKey: number }) => (
    <div data-testid="form-submissions">
      <span data-testid="fs-refresh-key">{props.refreshKey}</span>
    </div>
  ),
}));

import { FormList } from "@/components/form/FormList";
import type { FormItem } from "@/components/form/types";

function makeForm(overrides: Partial<FormItem> = {}): FormItem {
  return {
    id: "f-1",
    title: "Survey",
    description: "Yearly",
    fields: [],
    active: true,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T03:04:05Z",
    _count: { submissions: 3 },
    ...overrides,
  };
}

function renderList(wid = "ws-1") {
  return render(<FormList wid={wid} />);
}

async function waitForList() {
  await waitFor(() => expect(screen.getByText("Survey")).toBeInTheDocument());
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FormList", () => {
  it("挂载时 GET 表单列表并显示 loading", () => {
    mocks.api.mockReturnValue(new Promise(() => {}));
    renderList();
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/forms");
    expect(screen.getByText("form:loading")).toBeInTheDocument();
    expect(screen.getByText("form:title")).toBeInTheDocument();
  });

  it("列表项渲染标题/描述/启用状态/提交数", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    expect(screen.getByText("Yearly")).toBeInTheDocument();
    expect(screen.getByText("form:active")).toBeInTheDocument();
    expect(screen.getByText(/form:submissions: 3/)).toBeInTheDocument();
  });

  it("inactive 表单显示 inactive 徽标", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm({ active: false })], total: 1 });
    renderList();
    await waitForList();
    expect(screen.getByText("form:inactive")).toBeInTheDocument();
    expect(screen.queryByText("form:active")).not.toBeInTheDocument();
  });

  it("description 为 null 时不渲染描述行", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm({ description: null })], total: 1 });
    renderList();
    await waitForList();
    expect(screen.queryByText("Yearly")).not.toBeInTheDocument();
  });

  it("_count 缺失时提交数显示 0", async () => {
    const item = makeForm();
    delete item._count;
    mocks.api.mockResolvedValue({ items: [item], total: 1 });
    renderList();
    await waitForList();
    expect(screen.getByText(/form:submissions: 0/)).toBeInTheDocument();
  });

  it("空列表显示空态", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    renderList();
    await waitFor(() => expect(screen.getByText("form:noForms")).toBeInTheDocument());
  });

  it("加载失败 Error 显示错误消息", async () => {
    mocks.api.mockRejectedValue(new Error("db down"));
    renderList();
    await waitFor(() => expect(screen.getByText("db down")).toBeInTheDocument());
  });

  it("加载失败非 Error 显示 loadFailed", async () => {
    mocks.api.mockRejectedValue("oops");
    renderList();
    await waitFor(() => expect(screen.getByText("form:loadFailed")).toBeInTheDocument());
  });

  it("create 按钮打开构建器弹窗（新建模式、wid 透传）", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:create" }));
    expect(screen.getByRole("heading", { name: "form:create" })).toBeInTheDocument();
    expect(screen.getByTestId("fb-wid")).toHaveTextContent("ws-1");
    expect(screen.getByTestId("fb-form-id")).toHaveTextContent("new");
  });

  it("edit 按钮打开构建器弹窗（编辑模式传 form）", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:edit" }));
    expect(screen.getByRole("heading", { name: "form:edit" })).toBeInTheDocument();
    expect(screen.getByTestId("fb-form-id")).toHaveTextContent("f-1");
  });

  it("preview 按钮打开预览弹窗", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:preview" }));
    expect(screen.getByRole("heading", { name: "form:preview" })).toBeInTheDocument();
    expect(screen.getByTestId("fp-form-id")).toHaveTextContent("f-1");
  });

  it("submissions 按钮打开提交列表弹窗（refreshKey 初值 0）", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:submissions" }));
    expect(screen.getByRole("heading", { name: "form:submissions" })).toBeInTheDocument();
    expect(screen.getByTestId("fs-refresh-key")).toHaveTextContent("0");
  });

  it("弹窗 X 按钮关闭弹窗", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:edit" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    await waitFor(() => expect(screen.queryByTestId("form-builder")).not.toBeInTheDocument());
  });

  it("点击弹窗遮罩关闭，点击内层面板不关闭", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:edit" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.firstElementChild as Element);
    expect(screen.getByTestId("form-builder")).toBeInTheDocument();
    fireEvent.click(dialog);
    await waitFor(() => expect(screen.queryByTestId("form-builder")).not.toBeInTheDocument());
  });

  it("保存已有表单时原地替换并关闭弹窗", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:edit" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE_UPDATE" }));
    await waitFor(() => expect(screen.queryByTestId("form-builder")).not.toBeInTheDocument());
    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.queryByText("Survey")).not.toBeInTheDocument();
  });

  it("保存新表单时插入列表顶部并关闭弹窗", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:create" }));
    fireEvent.click(screen.getByRole("button", { name: "SAVE_NEW" }));
    await waitFor(() => expect(screen.getByText("Created")).toBeInTheDocument());
    expect(screen.queryByTestId("form-builder")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("构建器取消关闭弹窗且列表不变", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:edit" }));
    fireEvent.click(screen.getByRole("button", { name: "BUILDER_CANCEL" }));
    await waitFor(() => expect(screen.queryByTestId("form-builder")).not.toBeInTheDocument());
    expect(screen.getByText("Survey")).toBeInTheDocument();
  });

  it("预览提交成功后提交列表 refreshKey 递增", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:preview" }));
    fireEvent.click(screen.getByRole("button", { name: "PREVIEW_SUBMIT" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "form:submissions" }));
    await waitFor(() => expect(screen.getByTestId("fs-refresh-key")).toHaveTextContent("1"));
  });

  it("confirm 取消时不调用 DELETE", async () => {
    mocks.api.mockResolvedValue({ items: [makeForm()], total: 1 });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:delete" }));
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Survey")).toBeInTheDocument();
  });

  it("确认删除走 DELETE 并从列表移除，同列表其他项保留", async () => {
    mocks.api.mockResolvedValue({
      items: [makeForm(), makeForm({ id: "f-2", title: "Other" })],
      total: 2,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderList();
    await waitForList();
    fireEvent.click(screen.getAllByRole("button", { name: "form:delete" })[0]);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith(
      "/api/v1/workspaces/ws-1/forms/f-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    await waitFor(() => expect(screen.queryByText("Survey")).not.toBeInTheDocument());
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("删除失败 Error 显示消息，失败后 deletingId 复位可重试", async () => {
    mocks.api.mockResolvedValueOnce({ items: [makeForm()], total: 1 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.api.mockRejectedValueOnce(new Error("cannot delete"));
    renderList();
    await waitForList();
    const delBtn = screen.getByRole("button", { name: "form:delete" });
    fireEvent.click(delBtn);
    await waitFor(() => expect(screen.getByText("cannot delete")).toBeInTheDocument());
    expect(delBtn).toBeEnabled();
    expect(screen.getByText("Survey")).toBeInTheDocument();
  });

  it("删除失败非 Error 显示 deleteFailed", async () => {
    mocks.api.mockResolvedValueOnce({ items: [makeForm()], total: 1 });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.api.mockRejectedValueOnce("bad");
    renderList();
    await waitForList();
    fireEvent.click(screen.getByRole("button", { name: "form:delete" }));
    await waitFor(() => expect(screen.getByText("form:deleteFailed")).toBeInTheDocument());
  });

  it("删除进行中该行按钮禁用带 spinner 且其他行删除被守卫", async () => {
    mocks.api.mockResolvedValueOnce({
      items: [makeForm(), makeForm({ id: "f-2", title: "Other" })],
      total: 2,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let resolveDelete: (v: unknown) => void = () => {};
    mocks.api.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveDelete = r;
        }),
    );
    renderList();
    await waitForList();
    const delBtns = screen.getAllByRole("button", { name: "form:delete" });
    fireEvent.click(delBtns[0]);
    await waitFor(() => expect(delBtns[0]).toBeDisabled());
    expect(delBtns[0].querySelector(".animate-spin")).not.toBeNull();
    fireEvent.click(delBtns[1]);
    expect(mocks.api).toHaveBeenCalledTimes(2);
    resolveDelete(undefined);
    await waitFor(() => expect(screen.queryByText("Survey")).not.toBeInTheDocument());
    expect(screen.getByText("Other")).toBeInTheDocument();
  });
});
