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
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: class ApiError extends Error {} }));

/** 子编辑器只验证接线：用替身暴露 open / kr，避免它的成员拉取干扰本文件 */
const krEditorProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/components/okr/KeyResultEditor", () => ({
  default: (props: Record<string, unknown>) => {
    krEditorProps.current = props;
    if (!props.open) return null;
    return <div data-testid="kr-editor" />;
  },
}));

import { ObjectiveDetailPanel } from "@/components/okr/ObjectiveDetail";

const BASE = "/api/v1/workspaces/ws-1/objectives/o-1";

const detail = {
  id: "o-1",
  title: "Grow ARR",
  description: "top line\nsecond line",
  ownerId: "u-1",
  period: "2026-Q1",
  status: "active",
  progress: 42.5,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  owner: { id: "u-1", name: null, email: "owner@example.com" },
  keyResults: [
    {
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
    },
    {
      id: "kr-2",
      objectiveId: "o-1",
      title: "Zero target",
      targetValue: 0,
      currentValue: 5,
      unit: null,
      weight: 1,
      ownerId: null,
      dueDate: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      owner: null,
    },
  ],
};

function defaultApi(obj: unknown = detail) {
  mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
    if (opts?.method === "DELETE" || opts?.method === "PATCH") return {};
    return obj;
  });
}

function detailGetCalls() {
  return mocks.api.mock.calls.filter(([p, o]) => p === BASE && (!o || !o.method));
}

function renderPanel(overrides: Partial<Parameters<typeof ObjectiveDetailPanel>[0]> = {}) {
  const props = {
    wid: "ws-1",
    oid: "o-1",
    onClose: vi.fn(),
    onChanged: vi.fn(),
    ...overrides,
  };
  const utils = render(<ObjectiveDetailPanel {...props} />);
  return { ...utils, ...props };
}

async function renderLoaded(overrides: Partial<Parameters<typeof ObjectiveDetailPanel>[0]> = {}) {
  const utils = renderPanel(overrides);
  await waitFor(() => expect(screen.getByText("Grow ARR")).toBeInTheDocument());
  return utils;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  krEditorProps.current = null;
});

describe("ObjectiveDetailPanel", () => {
  it("头部与目标信息：标题、描述、状态徽章、周期、负责人姓名回退邮箱", async () => {
    defaultApi();
    const { container } = renderPanel();
    expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Grow ARR")).toBeInTheDocument());
    expect(screen.getByText("okr:objective")).toBeInTheDocument();
    expect(screen.getByText(/top line/)).toBeInTheDocument();
    expect(screen.getByText("okr:active")).toBeInTheDocument();
    expect(screen.getByText("2026-Q1")).toBeInTheDocument();
    // owner.name 为 null → 邮箱
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("43%")).toBeInTheDocument();
  });

  it("关键结果行：当前/目标+单位、权重、负责人、截止日期与进度钳制", async () => {
    defaultApi();
    const { container } = renderPanel();
    await waitFor(() => expect(screen.getByText("Sign 10 logos")).toBeInTheDocument());

    expect(screen.getByText("4/10 logos")).toBeInTheDocument();
    expect(screen.getByText("okr:weight: 2")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // dueDate 走 toLocalDateString（本地 YYYY-MM-DD）
    expect(screen.getByText(/2026-03-3\d/)).toBeInTheDocument();
    // 第二条 targetValue=0 → 进度 0 且不带单位
    expect(screen.getByText("5/0")).toBeInTheDocument();

    const bars = Array.from(container.querySelectorAll("li div[style]")) as HTMLElement[];
    expect(bars[0].style.width).toBe("40%");
    expect(bars[1].style.width).toBe("0%");
  });

  it("无关键结果时显示空态", async () => {
    defaultApi({ ...detail, keyResults: [] });
    renderPanel();
    await waitFor(() => expect(screen.getByText("Grow ARR")).toBeInTheDocument());
    expect(screen.getByText("okr:noObjectives")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("加载失败显示错误文案，关闭按钮仍可用", async () => {
    mocks.api.mockImplementation(async () => {
      throw new Error("detail-boom");
    });
    const { onClose } = renderPanel();
    await waitFor(() => expect(screen.getByText("detail-boom")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("button:close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("删除目标：确认后 DELETE 并回调 onChanged + onClose", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onChanged, onClose } = await renderLoaded();

    // 目标删除钮与每条 KR 的删除钮同为 aria-label，取 DOM 序首个（头部那个）
    fireEvent.click(screen.getAllByLabelText("okr:delete")[0]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    expect(mocks.api).toHaveBeenCalledWith(BASE, { method: "DELETE" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("删除目标取消时不发请求", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onClose } = await renderLoaded();

    fireEvent.click(screen.getAllByLabelText("okr:delete")[0]);
    expect(mocks.api.mock.calls.filter(([, o]) => o?.method === "DELETE")).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("删除关键结果：确认后 DELETE 并重新拉详情", async () => {
    defaultApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onChanged } = await renderLoaded();
    expect(detailGetCalls()).toHaveLength(1);

    const krRow = screen.getByText("Sign 10 logos").closest("li") as HTMLElement;
    fireEvent.click(within(krRow).getAllByLabelText("okr:delete")[0]);

    await waitFor(() => expect(detailGetCalls()).toHaveLength(2));
    expect(mocks.api).toHaveBeenCalledWith(`${BASE}/key-results/kr-1`, { method: "DELETE" });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("新增关键结果按钮打开子编辑器（kr 传 null）", async () => {
    defaultApi();
    await renderLoaded();

    expect(screen.queryByTestId("kr-editor")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "okr:addKeyResult" }));
    expect(screen.getByTestId("kr-editor")).toBeInTheDocument();
    expect(krEditorProps.current?.kr).toBeNull();
    expect(krEditorProps.current?.wid).toBe("ws-1");
  });

  it("编辑关键结果按钮把该条 KR 传给子编辑器", async () => {
    defaultApi();
    await renderLoaded();

    const krRow = screen.getByText("Sign 10 logos").closest("li") as HTMLElement;
    fireEvent.click(within(krRow).getAllByLabelText("okr:edit")[0]);
    expect(krEditorProps.current?.kr).toMatchObject({ id: "kr-1", title: "Sign 10 logos" });
  });

  it("编辑目标：预填后 PATCH trim 载荷，保存后重拉并回调", async () => {
    defaultApi();
    const { onChanged } = await renderLoaded();
    expect(detailGetCalls()).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("okr:editObjective"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("okr:title_")).toHaveValue("Grow ARR");
    expect(within(dialog).getByLabelText("okr:description")).toHaveValue("top line\nsecond line");
    expect(within(dialog).getByLabelText("okr:period")).toHaveValue("2026-Q1");
    expect(within(dialog).getByLabelText("okr:status")).toHaveValue("active");

    fireEvent.change(within(dialog).getByLabelText("okr:title_"), {
      target: { value: "  Grow ARR v2  " },
    });
    fireEvent.change(within(dialog).getByLabelText("okr:status"), {
      target: { value: "completed" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "button:save" }));

    await waitFor(() => expect(detailGetCalls()).toHaveLength(2));
    const patch = mocks.api.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(patch?.[0]).toBe(BASE);
    expect(JSON.parse((patch?.[1] as { body: string }).body)).toEqual({
      title: "Grow ARR v2",
      description: "top line\nsecond line",
      period: "2026-Q1",
      status: "completed",
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("编辑目标：标题或周期清空时保存禁用", async () => {
    defaultApi();
    await renderLoaded();

    fireEvent.click(screen.getByLabelText("okr:editObjective"));
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "button:save" });
    expect(save).toBeEnabled();

    fireEvent.change(within(dialog).getByLabelText("okr:title_"), { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("okr:title_"), { target: { value: "ok" } });
    fireEvent.change(within(dialog).getByLabelText("okr:period"), { target: { value: "" } });
    expect(save).toBeDisabled();
  });

  it("编辑目标失败：显示错误且弹窗不关", async () => {
    mocks.api.mockImplementation(async (path: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") throw new Error("patch-boom");
      return detail;
    });
    await renderLoaded();

    fireEvent.click(screen.getByLabelText("okr:editObjective"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("okr:title_"), { target: { value: "Renamed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "button:save" }));

    await waitFor(() => expect(screen.getByText("patch-boom")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(detailGetCalls()).toHaveLength(1);
  });

  it("编辑弹窗可由取消按钮与遮罩关闭", async () => {
    defaultApi();
    await renderLoaded();

    fireEvent.click(screen.getByLabelText("okr:editObjective"));
    fireEvent.click(screen.getByRole("button", { name: "button:cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // 该弹窗的遮罩层自身即 role="dialog"：点它就是点遮罩 → 关闭
    fireEvent.click(screen.getByLabelText("okr:editObjective"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
