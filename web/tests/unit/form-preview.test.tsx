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

import { FormPreview } from "@/components/form/FormPreview";
import type { FormFieldDefinition, FormItem } from "@/components/form/types";

function makeForm(fields: FormFieldDefinition[], overrides: Partial<FormItem> = {}): FormItem {
  return {
    id: "f-1",
    title: "Survey",
    description: "Please fill",
    fields,
    active: true,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    ...overrides,
  };
}

function renderPreview(
  fields: FormFieldDefinition[],
  props: { readOnly?: boolean; onSubmitSuccess?: () => void } = {},
) {
  return render(
    <FormPreview
      wid="ws-1"
      form={makeForm(fields)}
      readOnly={props.readOnly}
      onSubmitSuccess={props.onSubmitSuccess}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FormPreview", () => {
  it("渲染表单标题与描述", () => {
    renderPreview([]);
    expect(screen.getByText("Survey")).toBeInTheDocument();
    expect(screen.getByText("Please fill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "form:submit" })).toBeInTheDocument();
  });

  it("description 为 null 时不渲染描述但保留提交钮", () => {
    render(<FormPreview wid="ws-1" form={makeForm([], { description: null })} />);
    expect(screen.queryByText("Please fill")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "form:submit" })).toBeInTheDocument();
  });

  it("readOnly 不渲染提交钮且控件禁用", () => {
    renderPreview([{ id: "fld-1", type: "text", label: "Name", required: false }], {
      readOnly: true,
    });
    expect(screen.queryByRole("button", { name: "form:submit" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toBeDisabled();
  });

  it("readOnly 下 submit 事件被守卫不调用 api", () => {
    const { container } = renderPreview(
      [{ id: "fld-1", type: "text", label: "Name", required: false }],
      { readOnly: true },
    );
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("text/textarea/number/date 字段各自渲染对应控件", () => {
    renderPreview([
      { id: "f-text", type: "text", label: "TBox", required: false },
      { id: "f-area", type: "textarea", label: "AArea", required: false },
      { id: "f-num", type: "number", label: "NNum", required: false },
      { id: "f-date", type: "date", label: "DDate", required: false },
    ]);
    expect(screen.getByLabelText(/TBox/)).toHaveAttribute("type", "text");
    expect(screen.getByLabelText(/AArea/).tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText(/NNum/)).toHaveAttribute("type", "number");
    expect(screen.getByLabelText(/DDate/)).toHaveAttribute("type", "date");
  });

  it("select 字段渲染占位项与全部选项", () => {
    renderPreview([
      { id: "f-sel", type: "select", label: "Color", required: false, options: ["red", "blue"] },
    ]);
    const select = screen.getByLabelText(/Color/);
    expect(select.tagName).toBe("SELECT");
    expect(select.querySelector('option[value=""]')?.textContent).toBe("—");
    expect((select as HTMLSelectElement).options).toHaveLength(3);
  });

  it("radio 字段共享 name 且单选互斥", () => {
    renderPreview([
      { id: "f-rad", type: "radio", label: "Pick", required: false, options: ["red", "blue"] },
    ]);
    const red = screen.getByLabelText("red");
    const blue = screen.getByLabelText("blue");
    expect(red).toHaveAttribute("type", "radio");
    expect(red).toHaveAttribute("name", "fp-f-rad");
    fireEvent.click(red);
    expect(red).toBeChecked();
    expect(blue).not.toBeChecked();
    fireEvent.click(blue);
    expect(blue).toBeChecked();
    expect(red).not.toBeChecked();
  });

  it("checkbox 字段勾选写值、取消清空", () => {
    renderPreview([
      { id: "f-chk", type: "checkbox", label: "Tags", required: false, options: ["a", "b"] },
    ]);
    const a = screen.getByLabelText("a");
    fireEvent.click(a);
    expect(a).toBeChecked();
    fireEvent.click(a);
    expect(a).not.toBeChecked();
  });

  it("必填字段标签带 * 标记", () => {
    renderPreview([{ id: "f-r", type: "text", label: "NeedName", required: true }]);
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("提交发送 POST：body 为当前值，成功显示提示、清空值并回调", async () => {
    const onSubmitSuccess = vi.fn();
    mocks.api.mockResolvedValue(undefined);
    renderPreview([{ id: "fld-1", type: "text", label: "Name", required: false }], {
      onSubmitSuccess,
    });
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "form:submit" }));
    await waitFor(() => expect(screen.getByText("form:submitSuccess")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/forms/f-1/submissions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ data: { "fld-1": "Alice" } }),
      }),
    );
    expect(onSubmitSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Name/)).toHaveValue("");
  });

  it("select 与 radio 的选中值进入提交负载", async () => {
    mocks.api.mockResolvedValue(undefined);
    renderPreview([
      { id: "f-sel", type: "select", label: "Color", required: false, options: ["red", "blue"] },
      { id: "f-rad", type: "radio", label: "Pick", required: false, options: ["x", "y"] },
    ]);
    fireEvent.change(screen.getByLabelText(/Color/), { target: { value: "blue" } });
    fireEvent.click(screen.getByLabelText("y"));
    fireEvent.click(screen.getByRole("button", { name: "form:submit" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    const body = JSON.parse((mocks.api.mock.calls[0][1] as { body: string }).body);
    expect(body.data).toEqual({ "f-sel": "blue", "f-rad": "y" });
  });

  it("提交失败 Error 显示消息，非 Error 显示 submitFailed", async () => {
    mocks.api.mockRejectedValueOnce(new Error("gone"));
    renderPreview([{ id: "fld-1", type: "text", label: "Name", required: false }]);
    fireEvent.click(screen.getByRole("button", { name: "form:submit" }));
    await waitFor(() => expect(screen.getByText("gone")).toBeInTheDocument());
    mocks.api.mockRejectedValueOnce("bad");
    fireEvent.click(screen.getByRole("button", { name: "form:submit" }));
    await waitFor(() => expect(screen.getByText("form:submitFailed")).toBeInTheDocument());
    expect(screen.queryByText("gone")).not.toBeInTheDocument();
  });

  it("提交中按钮禁用带 spinner，完成后复位", async () => {
    let resolveApi: (v: unknown) => void = () => {};
    mocks.api.mockImplementation(
      () =>
        new Promise((r) => {
          resolveApi = r;
        }),
    );
    renderPreview([{ id: "fld-1", type: "text", label: "Name", required: false }]);
    const submitBtn = screen.getByRole("button", { name: "form:submit" });
    fireEvent.click(submitBtn);
    expect(submitBtn).toBeDisabled();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    resolveApi(undefined);
    await waitFor(() => expect(submitBtn).toBeEnabled());
  });

  it("错误条 X 按钮清空错误", async () => {
    mocks.api.mockRejectedValueOnce(new Error("gone"));
    renderPreview([{ id: "fld-1", type: "text", label: "Name", required: false }]);
    fireEvent.click(screen.getByRole("button", { name: "form:submit" }));
    await waitFor(() => expect(screen.getByText("gone")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "form:close" }));
    expect(screen.queryByText("gone")).not.toBeInTheDocument();
  });
});
