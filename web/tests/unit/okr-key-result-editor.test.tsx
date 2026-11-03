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

const mocks = vi.hoisted(() => ({ api: vi.fn(), apiList: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: mocks.api,
  apiList: mocks.apiList,
  ApiError: class ApiError extends Error {},
}));

import KeyResultEditor from "@/components/okr/KeyResultEditor";

const BASE = "/api/v1/workspaces/ws-1/objectives/o-1/key-results";
const MEMBERS = "/api/v1/workspaces/ws-1/members";

const members = [
  { id: "u-1", name: "Alice", email: "alice@example.com" },
  { id: "u-2", name: null, email: "bob@example.com" },
];

const kr = {
  id: "kr-1",
  objectiveId: "o-1",
  title: "Sign 10 logos",
  targetValue: 10,
  currentValue: 4,
  unit: "logos",
  weight: 2,
  ownerId: "u-2",
  dueDate: "2026-03-31T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  owner: { id: "u-2", name: "Bob", email: "bob@example.com" },
};

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as { body: string }).body);
}

function renderEditor(overrides: Partial<Parameters<typeof KeyResultEditor>[0]> = {}) {
  const props = {
    wid: "ws-1",
    oid: "o-1",
    kr: null,
    open: true,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  const utils = render(<KeyResultEditor {...props} />);
  return { ...utils, ...props };
}

function defaultApi() {
  mocks.apiList.mockImplementation(async () => members);
  mocks.api.mockImplementation(async () => ({}));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("KeyResultEditor", () => {
  it("open=false 时不渲染", () => {
    defaultApi();
    renderEditor({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.apiList).not.toHaveBeenCalled();
  });

  it("新建模式：默认当前值 0、权重 1，标题与目标值留空，保存禁用", async () => {
    defaultApi();
    renderEditor();
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalledWith(MEMBERS));

    expect(screen.getByLabelText("okr:title_")).toHaveValue("");
    expect(screen.getByLabelText("okr:targetValue")).toHaveValue(null);
    expect(screen.getByLabelText("okr:currentValue")).toHaveValue(0);
    expect(screen.getByLabelText("okr:weight")).toHaveValue(1);
    expect(screen.getByLabelText("okr:unit")).toHaveValue("");
    expect(screen.getByLabelText("okr:dueDate")).toHaveValue("");
    expect(screen.getByRole("button", { name: "okr:addKeyResult" })).toBeDisabled();
  });

  it("成员下拉含占位与姓名/邮箱回退", async () => {
    defaultApi();
    renderEditor();
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalledWith(MEMBERS));

    const select = screen.getByLabelText("okr:owner") as HTMLSelectElement;
    await waitFor(() =>
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
        "—",
        "Alice",
        "bob@example.com",
      ]),
    );
  });

  it("新建提交：POST 载荷含解析后的数值与可选字段", async () => {
    defaultApi();
    const { onSaved, onClose } = renderEditor();
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("okr:title_"), { target: { value: "  Ship v1  " } });
    fireEvent.change(screen.getByLabelText("okr:targetValue"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("okr:currentValue"), { target: { value: "25.5" } });
    fireEvent.change(screen.getByLabelText("okr:unit"), { target: { value: "  pts  " } });
    fireEvent.change(screen.getByLabelText("okr:weight"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("okr:owner"), { target: { value: "u-1" } });
    fireEvent.change(screen.getByLabelText("okr:dueDate"), { target: { value: "2026-04-15" } });
    fireEvent.click(screen.getByRole("button", { name: "okr:addKeyResult" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    const post = mocks.api.mock.calls.find(([, o]) => o?.method === "POST");
    expect(post?.[0]).toBe(BASE);
    expect(bodyOf(post ?? [])).toEqual({
      title: "Ship v1",
      targetValue: 100,
      currentValue: 25.5,
      unit: "pts",
      weight: 3,
      ownerId: "u-1",
      dueDate: new Date(2026, 3, 15, 0, 0, 0, 0).toISOString(),
    });
  });

  it("可选字段留空时省略 unit/ownerId/dueDate，数值回退默认", async () => {
    defaultApi();
    renderEditor();
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("okr:title_"), { target: { value: "Bare" } });
    fireEvent.change(screen.getByLabelText("okr:targetValue"), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("okr:currentValue"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("okr:weight"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "okr:addKeyResult" }));

    await waitFor(() =>
      expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "POST")).toHaveLength(1),
    );
    const post = mocks.api.mock.calls.find(([, o]) => o?.method === "POST");
    expect(bodyOf(post ?? [])).toEqual({
      title: "Bare",
      targetValue: 0,
      currentValue: 0,
      weight: 1,
    });
  });

  it("编辑模式：预填全部字段（含本地日期）并 PATCH 到子路径", async () => {
    defaultApi();
    const { onSaved } = renderEditor({ kr });
    await waitFor(() => expect(screen.getByLabelText("okr:title_")).toHaveValue("Sign 10 logos"));

    expect(screen.getByLabelText("okr:targetValue")).toHaveValue(10);
    expect(screen.getByLabelText("okr:currentValue")).toHaveValue(4);
    expect(screen.getByLabelText("okr:unit")).toHaveValue("logos");
    expect(screen.getByLabelText("okr:weight")).toHaveValue(2);
    expect(screen.getByLabelText("okr:owner")).toHaveValue("u-2");
    expect(screen.getByLabelText("okr:dueDate")).toHaveValue("2026-03-31");

    fireEvent.change(screen.getByLabelText("okr:currentValue"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "okr:edit" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(patch?.[0]).toBe(`${BASE}/kr-1`);
    expect(bodyOf(patch ?? [])).toMatchObject({ title: "Sign 10 logos", currentValue: 7 });
  });

  it("提交失败：显示错误、不关闭、按钮恢复", async () => {
    mocks.apiList.mockImplementation(async () => members);
    mocks.api.mockImplementation(async () => {
      throw new Error("kr-boom");
    });
    const { onSaved, onClose } = renderEditor();
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText("okr:title_"), { target: { value: "T" } });
    fireEvent.click(screen.getByRole("button", { name: "okr:addKeyResult" }));

    await waitFor(() => expect(screen.getByText("kr-boom")).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "okr:addKeyResult" })).toBeEnabled();
  });

  it("成员接口失败静默：下拉只剩占位", async () => {
    mocks.apiList.mockImplementation(async () => {
      throw new Error("members down");
    });
    mocks.api.mockImplementation(async () => ({}));
    renderEditor();
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalled());

    const select = screen.getByLabelText("okr:owner") as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
  });

  it("Esc 关闭、遮罩点击关闭、内容区点击不关闭", () => {
    defaultApi();
    const { onClose } = renderEditor();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);

    const overlay = screen.getByRole("presentation");
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("头部关闭按钮与取消按钮都回调 onClose", () => {
    defaultApi();
    const { onClose } = renderEditor();

    fireEvent.click(screen.getByLabelText("button:close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "button:cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
