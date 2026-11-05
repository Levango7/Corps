// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

/**
 * BatchToolbar 契约（components/BatchToolbar.tsx）：
 *  - selectedIds 为空 → 不渲染
 *  - role=toolbar（aria-label）+ 选中计数
 *  - 状态/优先级下拉：按钮 aria-expanded 开合，menu 内各 4 个 menuitem
 *    （status:todo/in_progress/review/done、priority:low/medium/high/urgent）；
 *    点击 menuitem → onUpdate({status}/{priority}) 并关菜单；两菜单互斥
 *  - Escape / 工具栏外 pointerdown 关闭菜单；工具栏内点击不关
 *  - 删除两步确认（R8B-01）：首次点击进确认态（文案 task:delete?、title=batchDeleteConfirm），
 *    3s 自动重置；再次点击才 onDelete
 *  - busy：pending 时按钮 disabled + spinner；失败显示 message，可点关闭清除
 *  - 取消选择按钮 → onClear
 *
 * 实测边界说明：菜单开合/确认态/错误分支均从 DOM（aria-expanded、role=menu、文案、title）观察。
 * 组件 finally 中的 requestAnimationFrame（焦点恢复）在本仓 jsdom 不存在，需同步桩（立即执行）。
 * 3s 确认重置用 fake timers + act(vi.advanceTimersByTimeAsync)，不与 waitFor 混用。
 */

const h = vi.hoisted(() => ({
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onClear: vi.fn(),
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

import { BatchToolbar } from "@/components/BatchToolbar";

function renderToolbar(selectedIds: string[] = ["a", "b", "c"]) {
  return render(
    <BatchToolbar
      selectedIds={selectedIds}
      onClear={h.onClear}
      onUpdate={h.onUpdate}
      onDelete={h.onDelete}
    />,
  );
}

const STATUS_ITEMS = ["status:todo", "status:in_progress", "status:review", "status:done"];
const PRIORITY_ITEMS = ["priority:low", "priority:medium", "priority:high", "priority:urgent"];

beforeEach(() => {
  h.onUpdate.mockReset();
  h.onDelete.mockReset();
  h.onClear.mockReset();
  h.onUpdate.mockResolvedValue({ updated: 1, skipped: 0 });
  h.onDelete.mockResolvedValue({ deleted: 1, skipped: 0 });
  // 本仓 jsdom 无 requestAnimationFrame（finally 中焦点恢复需要）：立即执行
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BatchToolbar 基础渲染", () => {
  it("selectedIds 为空 → 不渲染", () => {
    const { container } = renderToolbar([]);
    expect(container.firstChild).toBeNull();
  });

  it("role=toolbar + aria-label + 选中计数", () => {
    renderToolbar();
    expect(screen.getByRole("toolbar", { name: "task:batchToolbarAria" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("取消选择按钮点击 → onClear 调用一次", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "task:clearSelectionAria" }));
    expect(h.onClear).toHaveBeenCalledTimes(1);
  });
});

describe("BatchToolbar 下拉菜单", () => {
  it("状态按钮默认关闭，点击展开 4 个状态 menuitem，再点击收起", () => {
    renderToolbar();
    const trigger = screen.getByRole("button", { name: "task:batchStatusAria" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    STATUS_ITEMS.forEach((name) => {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("点击状态 menuitem → onUpdate({status}) 且菜单关闭", async () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "task:batchStatusAria" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "status:done" }));
    await waitFor(() => expect(h.onUpdate).toHaveBeenCalledTimes(1));
    expect(h.onUpdate).toHaveBeenCalledWith({ status: "done" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("优先级菜单 4 个 menuitem，点击 → onUpdate({priority})", async () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "task:batchPriorityAria" }));
    PRIORITY_ITEMS.forEach((name) => {
      expect(screen.getByRole("menuitem", { name })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "priority:urgent" }));
    await waitFor(() => expect(h.onUpdate).toHaveBeenCalledWith({ priority: "urgent" }));
  });

  it("两菜单互斥：打开优先级菜单会关闭状态菜单", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "task:batchStatusAria" }));
    expect(screen.getByRole("menuitem", { name: "status:todo" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "task:batchPriorityAria" }));
    // 状态菜单关闭、优先级菜单打开（此时文档中的 menu 是优先级的）
    expect(screen.queryByRole("menuitem", { name: "status:todo" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "priority:low" })).toBeInTheDocument();
  });

  it("Escape 键关闭已打开的菜单", () => {
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "task:batchStatusAria" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("工具栏外 pointerdown 关闭菜单，工具栏内点击不关", () => {
    const { container } = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "task:batchStatusAria" }));
    // 工具栏内部 pointerdown（分隔符）不关闭
    fireEvent.pointerDown(container.querySelector('span[aria-hidden="true"]') as Element);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // 工具栏外部 pointerdown 关闭
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("BatchToolbar 两步确认删除", () => {
  it("首次点击进确认态（文案+title），未调用 onDelete；再次点击才执行", () => {
    renderToolbar();
    const del = screen.getByRole("button", { name: "task:batchDeleteAria" });
    fireEvent.click(del);
    expect(screen.getByText("task:delete?")).toBeInTheDocument();
    expect(del).toHaveAttribute("title", 'task:batchDeleteConfirm:{"count":3}');
    expect(h.onDelete).not.toHaveBeenCalled();
    fireEvent.click(del);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("task:delete?")).not.toBeInTheDocument();
  });

  it("确认态 3 秒无操作自动重置", async () => {
    vi.useFakeTimers();
    try {
      renderToolbar();
      const del = screen.getByRole("button", { name: "task:batchDeleteAria" });
      fireEvent.click(del);
      expect(screen.getByText("task:delete?")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.queryByText("task:delete?")).not.toBeInTheDocument();
      expect(screen.getByText("task:delete")).toBeInTheDocument();
      expect(h.onDelete).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BatchToolbar busy 与错误", () => {
  it("onUpdate pending：按钮 disabled 且 spinner（animate-spin）出现", () => {
    h.onUpdate.mockImplementation(() => new Promise(() => {}));
    const { container } = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "task:batchStatusAria" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "status:todo" }));
    expect(screen.getByRole("button", { name: "task:batchStatusAria" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "task:batchDeleteAria" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "task:clearSelectionAria" })).toBeDisabled();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("onUpdate 失败 → 显示错误 message；点关闭按钮（task:cancel）清除", async () => {
    h.onUpdate.mockRejectedValueOnce(new Error("批量更新失败"));
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "task:batchStatusAria" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "status:done" }));
    await waitFor(() => expect(screen.getByText("批量更新失败")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("task:cancel"));
    expect(screen.queryByText("批量更新失败")).not.toBeInTheDocument();
  });

  it("onDelete 失败 → 显示错误 message", async () => {
    h.onDelete.mockRejectedValueOnce(new Error("删除被拒绝"));
    renderToolbar();
    const del = screen.getByRole("button", { name: "task:batchDeleteAria" });
    fireEvent.click(del);
    fireEvent.click(del);
    await waitFor(() => expect(screen.getByText("删除被拒绝")).toBeInTheDocument());
  });
});
