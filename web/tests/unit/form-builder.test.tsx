// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

import { FormBuilder } from "@/components/form/FormBuilder";
import type { FormItem } from "@/components/form/types";

function makeForm(overrides: Partial<FormItem> = {}): FormItem {
  return {
    id: "f-1",
    title: "Survey",
    description: "Yearly survey",
    fields: [
      { id: "fld-1", type: "text", label: "Name", required: true },
      { id: "fld-2", type: "select", label: "Color", required: false, options: ["red", "blue"] },
    ],
    active: false,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
    ...overrides,
  };
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function renderBuilder(form: FormItem | null = null, wid = "ws-1") {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<FormBuilder wid={wid} form={form} onSaved={onSaved} onCancel={onCancel} />);
  return { ...utils, onSaved, onCancel };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FormBuilder", () => {
  it("新建模式初始为空、启用默认勾选、字段区显示空态", () => {
    renderBuilder();
    expect(screen.getByLabelText("form:name")).toHaveValue("");
    expect(screen.getByLabelText("form:description")).toHaveValue("");
    expect(screen.getByLabelText("form:active")).toBeChecked();
    expect(screen.getByText("form:noForms")).toBeInTheDocument();
    expect(screen.queryByLabelText(/form:fieldOptions/)).not.toBeInTheDocument();
  });

  it("编辑模式预填标题/描述/字段/启用状态与选项", () => {
    renderBuilder(makeForm());
    expect(screen.getByLabelText("form:name")).toHaveValue("Survey");
    expect(screen.getByLabelText("form:description")).toHaveValue("Yearly survey");
    expect(screen.getByLabelText("form:active")).not.toBeChecked();
    expect(screen.getByLabelText("form:fieldLabel 1")).toHaveValue("Name");
    expect(screen.getByLabelText("form:fieldLabel 2")).toHaveValue("Color");
    expect(screen.getByLabelText("form:fieldOptions 2")).toHaveValue("red\nblue");
    expect(screen.queryByLabelText("form:fieldOptions 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("form:fieldRequired 1")).toBeChecked();
    expect(screen.getByLabelText("form:fieldRequired 2")).not.toBeChecked();
  });

  it("form 切换回 null 时重置表单", () => {
    const { rerender } = renderBuilder(makeForm());
    rerender(<FormBuilder wid="ws-1" form={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("form:name")).toHaveValue("");
    expect(screen.getByLabelText("form:active")).toBeChecked();
    expect(screen.getByText("form:noForms")).toBeInTheDocument();
  });

  it("添加字段按钮追加 text 字段并清掉空态", () => {
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "form:addField" }));
    expect(screen.queryByText("form:noForms")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/form:fieldLabel \d/)).toHaveLength(1);
    expect(screen.getByRole("combobox")).toHaveValue("text");
    expect(screen.queryByLabelText(/form:fieldOptions/)).not.toBeInTheDocument();
  });

  it("删除字段按钮只移除该字段", () => {
    renderBuilder(makeForm());
    const items = screen.getAllByRole("listitem");
    fireEvent.click(within(items[1]).getByRole("button", { name: "form:removeField" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByLabelText("form:fieldLabel 1")).toHaveValue("Name");
  });

  it("上/下移动交换顺序且首行上移、尾行下移被禁用", () => {
    renderBuilder(makeForm());
    const items = screen.getAllByRole("listitem");
    const first = within(items[0]).getAllByRole("button", { name: "form:fieldLabel" });
    const second = within(items[1]).getAllByRole("button", { name: "form:fieldLabel" });
    expect(first[0]).toBeDisabled();
    expect(first[1]).toBeEnabled();
    expect(second[0]).toBeEnabled();
    expect(second[1]).toBeDisabled();
    fireEvent.click(second[0]);
    expect(screen.getByLabelText("form:fieldLabel 1")).toHaveValue("Color");
    expect(screen.getByLabelText("form:fieldLabel 2")).toHaveValue("Name");
  });

  it("字段类型切换为 radio 时出现 options 输入，切回 text 时消失", () => {
    renderBuilder(makeForm());
    const items = screen.getAllByRole("listitem");
    const typeSelect = within(items[0]).getByRole("combobox");
    fireEvent.change(typeSelect, { target: { value: "radio" } });
    expect(screen.getByLabelText("form:fieldOptions 1")).toBeInTheDocument();
    fireEvent.change(typeSelect, { target: { value: "text" } });
    expect(screen.queryByLabelText("form:fieldOptions 1")).not.toBeInTheDocument();
  });

  it("options 按换行切分并 trim，全空时保存不带 options", async () => {
    renderBuilder(makeForm());
    const resolved = {
      id: "f-1",
      title: "Survey",
      description: null,
      fields: [],
      active: true,
      createdAt: "",
      updatedAt: "",
    };
    mocks.api.mockResolvedValue(resolved);
    const opts = screen.getByLabelText("form:fieldOptions 2");
    fireEvent.change(opts, { target: { value: " green \n\nblue " } });
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(bodyOf(mocks.api.mock.calls[0]).fields[1]).toMatchObject({ options: ["green", "blue"] });
    fireEvent.change(screen.getByLabelText("form:fieldOptions 2"), { target: { value: "   \n " } });
    mocks.api.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(bodyOf(mocks.api.mock.calls[0]).fields[1].options).toBeUndefined();
  });

  it("required 复选框切换进入保存负载", async () => {
    renderBuilder(makeForm());
    mocks.api.mockResolvedValue({ id: "f-1" });
    fireEvent.click(screen.getByLabelText("form:fieldRequired 1"));
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    await waitFor(() => expect(mocks.api).toHaveBeenCalled());
    expect(bodyOf(mocks.api.mock.calls[0]).fields[0]).toMatchObject({ required: false });
  });

  it("空标题保存显示错误且不调用 api", () => {
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    expect(screen.getByText("form:title")).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("所有字段 label 为空保存显示 addField 错误", () => {
    renderBuilder();
    fireEvent.change(screen.getByLabelText("form:name"), { target: { value: "T" } });
    fireEvent.click(screen.getByRole("button", { name: "form:addField" }));
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    const banner = document.querySelector('div[class*="danger-soft"] > span');
    expect(banner?.textContent).toBe("form:addField");
  });

  it("新建保存走 POST：标题 trim、空描述省略、空 label 字段丢弃、非选项类型剥离 options", async () => {
    const { onSaved } = renderBuilder();
    fireEvent.change(screen.getByLabelText("form:name"), { target: { value: "  New Form  " } });
    fireEvent.click(screen.getByRole("button", { name: "form:addField" }));
    fireEvent.change(screen.getByLabelText("form:fieldLabel 1"), { target: { value: " Email " } });
    fireEvent.click(screen.getByRole("button", { name: "form:addField" }));
    const created = {
      id: "f-9",
      title: "New Form",
      description: null,
      fields: [],
      active: true,
      createdAt: "",
      updatedAt: "",
    };
    mocks.api.mockResolvedValue(created);
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/forms",
      expect.objectContaining({ method: "POST" }),
    );
    const body = bodyOf(mocks.api.mock.calls[0]);
    expect(body.title).toBe("New Form");
    expect(body.active).toBe(true);
    expect("description" in body).toBe(false);
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0]).toMatchObject({ label: "Email", type: "text" });
    expect("options" in body.fields[0]).toBe(false);
  });

  it("编辑保存走 PATCH 且保留选项类型 options", async () => {
    const { onSaved } = renderBuilder(makeForm());
    const updated = { ...makeForm(), title: "Survey" };
    mocks.api.mockResolvedValue(updated);
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/v1/workspaces/ws-1/forms/f-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    const body = bodyOf(mocks.api.mock.calls[0]);
    expect(body.title).toBe("Survey");
    expect(body.fields).toHaveLength(2);
    expect(body.fields[0]).toMatchObject({ label: "Name", required: true });
    expect(body.fields[1]).toMatchObject({ options: ["red", "blue"] });
  });

  it("保存失败 Error 显示消息、非 Error 显示 saveFailed、按钮复位", async () => {
    renderBuilder(makeForm());
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "form:save" })).toBeEnabled();
    mocks.api.mockRejectedValueOnce("nope");
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    await waitFor(() => expect(screen.getByText("form:saveFailed")).toBeInTheDocument());
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
  });

  it("保存中按钮禁用带 spinner 且双击只调一次 api", async () => {
    renderBuilder(makeForm());
    let resolveApi: (v: unknown) => void = () => {};
    mocks.api.mockImplementation(
      () =>
        new Promise((r) => {
          resolveApi = r;
        }),
    );
    const saveBtn = screen.getByRole("button", { name: "form:save" });
    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(saveBtn).toBeDisabled();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
    resolveApi({ id: "f-1" });
    await waitFor(() => expect(screen.getByRole("button", { name: "form:save" })).toBeEnabled());
  });

  it("取消按钮调用 onCancel", () => {
    const { onCancel } = renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "form:cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("错误条 X 按钮清空错误", () => {
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "form:save" }));
    expect(screen.getByText("form:title")).toBeInTheDocument();
    const dismiss = screen.getAllByRole("button", { name: "form:removeField" }).at(-1)!;
    fireEvent.click(dismiss);
    expect(screen.queryByText("form:title")).not.toBeInTheDocument();
  });
});
