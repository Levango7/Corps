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

import { FormSubmissionList } from "@/components/form/FormSubmissionList";
import type { FormItem, FormSubmissionItem } from "@/components/form/types";

function makeForm(): FormItem {
  return {
    id: "f-1",
    title: "Survey",
    description: null,
    fields: [],
    active: true,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-02T00:00:00Z",
  };
}

function makeSubmission(overrides: Partial<FormSubmissionItem> = {}): FormSubmissionItem {
  return {
    id: "s-1",
    data: { name: "Alice", color: "red" },
    submittedAt: "2026-11-01T10:00:00Z",
    submitter: { id: "u-1", name: "Alice", email: "alice@example.com" },
    ...overrides,
  };
}

function renderList(refreshKey = 0, wid = "ws-1") {
  return render(<FormSubmissionList wid={wid} form={makeForm()} refreshKey={refreshKey} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FormSubmissionList", () => {
  it("挂载时 GET 提交列表并显示 loading", () => {
    mocks.api.mockReturnValue(new Promise(() => {}));
    renderList();
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-1/forms/f-1/submissions");
    expect(screen.getByText("form:loading")).toBeInTheDocument();
    expect(screen.getByText("form:submissions")).toBeInTheDocument();
  });

  it("空列表显示空态", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    renderList();
    await waitFor(() => expect(screen.getByText("form:noForms")).toBeInTheDocument());
  });

  it("加载失败 Error 显示错误消息", async () => {
    mocks.api.mockRejectedValue(new Error("gone"));
    renderList();
    await waitFor(() => expect(screen.getByText("gone")).toBeInTheDocument());
  });

  it("加载失败非 Error 显示 loadFailed", async () => {
    mocks.api.mockRejectedValue("bad");
    renderList();
    await waitFor(() => expect(screen.getByText("form:loadFailed")).toBeInTheDocument());
  });

  it("摘要：三个以内字段用逗号连接且无截断符", async () => {
    mocks.api.mockResolvedValue({ items: [makeSubmission()], total: 1 });
    renderList();
    await waitFor(() => expect(screen.getByText("name: Alice, color: red")).toBeInTheDocument());
  });

  it("摘要：超过三个字段只取前三并追加 …", async () => {
    mocks.api.mockResolvedValue({
      items: [
        makeSubmission({
          id: "s-4",
          data: { a: "1", b: "2", c: "3", d: "4" },
        }),
      ],
      total: 1,
    });
    renderList();
    await waitFor(() => expect(screen.getByText("a: 1, b: 2, c: 3…")).toBeInTheDocument());
  });

  it("摘要：object 值序列化为 JSON，空数据显示 —", async () => {
    mocks.api.mockResolvedValue({
      items: [
        makeSubmission({ id: "s-o", data: { nested: { a: 1 } } }),
        makeSubmission({ id: "s-e", data: {} }),
      ],
      total: 2,
    });
    renderList();
    await waitFor(() => expect(screen.getByText('nested: {"a":1}')).toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("提交人优先 name，缺 name 回退 email，null 显示 —", async () => {
    mocks.api.mockResolvedValue({
      items: [
        makeSubmission(),
        makeSubmission({
          id: "s-2",
          submitter: { id: "u-2", name: null, email: "bob@example.com" },
        }),
        makeSubmission({ id: "s-3", submitter: null }),
      ],
      total: 3,
    });
    renderList();
    await waitFor(() => expect(screen.getByText(/form:submittedBy: Alice/)).toBeInTheDocument());
    expect(screen.getByText(/form:submittedBy: bob@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/form:submittedBy: —/)).toBeInTheDocument();
  });

  it("行内显示提交时间", async () => {
    mocks.api.mockResolvedValue({ items: [makeSubmission()], total: 1 });
    renderList();
    await waitFor(() => expect(screen.getByText(/form:submittedAt: .+/)).toBeInTheDocument());
  });

  it("详情按钮打开弹窗：JSON 正文、提交人/时间，X 按钮关闭", async () => {
    mocks.api.mockResolvedValue({ items: [makeSubmission()], total: 1 });
    renderList();
    await waitFor(() => expect(screen.getByText("name: Alice, color: red")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "form:data" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "form:data" })).toBeInTheDocument();
    expect(document.querySelector("pre")?.textContent).toContain('"name": "Alice"');
    expect(screen.getAllByText(/form:submittedBy: Alice/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "form:close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("点击详情遮罩关闭，点击内层面板不关闭", async () => {
    mocks.api.mockResolvedValue({ items: [makeSubmission()], total: 1 });
    renderList();
    await waitFor(() => expect(screen.getByRole("button", { name: "form:data" })));
    fireEvent.click(screen.getByRole("button", { name: "form:data" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.firstElementChild as Element);
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("refreshKey 变化触发重新拉取", async () => {
    mocks.api.mockResolvedValue({ items: [], total: 0 });
    const { rerender } = renderList(0);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    rerender(<FormSubmissionList wid="ws-1" form={makeForm()} refreshKey={1} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  });
});
