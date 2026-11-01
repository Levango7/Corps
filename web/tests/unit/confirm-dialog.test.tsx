// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ConfirmDialog } from "@/components/task/ConfirmDialog";

/**
 * 确认弹窗契约（components/task/ConfirmDialog.tsx）：
 *  - open=false 不渲染；open=true → role=dialog + aria-modal + aria-label
 *  - 文案两级：labels 覆盖（files 等模块复用）优先；不传则走 task 命名空间默认删除文案
 *  - 交互：取消 → onClose；确认 → **先 onConfirm 再 onClose**；点遮罩关、点面板不关
 *  - deleting：确认按钮 disabled + spinner；**Escape 在 deleting 时不关闭**
 *  - 焦点：打开时移入首个可聚焦元素，关闭时恢复先前焦点；Tab/Shift+Tab 在首尾循环（focus trap）
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

const baseProps = () => ({
  open: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  deleting: false,
  taskTitle: "交付 v1",
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("渲染与文案", () => {
  it("open=false：不渲染任何内容", () => {
    const { container } = render(<ConfirmDialog {...baseProps()} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("open=true：role=dialog + aria-modal + aria-label；默认 task 文案（含标题插值）", () => {
    const { getByRole, getByText } = render(<ConfirmDialog {...baseProps()} />);
    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("task:confirmAria");
    expect(getByText("task:confirmDeleteTitle")).toBeTruthy();
    expect(getByText(/task:confirmDeleteTask/)).toBeTruthy();
    expect(getByText("task:confirmDelete")).toBeTruthy();
    expect(getByText("button:cancel")).toBeTruthy();
  });

  it("labels 覆盖优先（files 模块复用场景）：不再走 task 命名空间", () => {
    const labels = {
      aria: "删除文件",
      title: "确认删除文件？",
      description: "文件将被永久删除",
      confirm: "删除",
      cancel: "取消",
    };
    const { getByRole, getByText, queryByText } = render(
      <ConfirmDialog {...baseProps()} labels={labels} />,
    );
    expect(getByRole("dialog").getAttribute("aria-label")).toBe("删除文件");
    expect(getByText("确认删除文件？")).toBeTruthy();
    expect(getByText("文件将被永久删除")).toBeTruthy();
    expect(getByText("删除")).toBeTruthy();
    expect(getByText("取消")).toBeTruthy();
    expect(queryByText("task:confirmDeleteTitle")).toBeNull();
  });
});

describe("交互", () => {
  it("取消 → onClose；确认 → 先 onConfirm 再 onClose", () => {
    const props = baseProps();
    const order: string[] = [];
    props.onConfirm.mockImplementation(() => order.push("confirm"));
    props.onClose.mockImplementation(() => order.push("close"));
    const { getByText } = render(<ConfirmDialog {...props} />);
    fireEvent.click(getByText("button:cancel"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    order.length = 0; // 只观察确认这次点击的先后
    fireEvent.click(getByText("task:confirmDelete"));
    expect(order).toEqual(["confirm", "close"]);
  });

  it("点遮罩关闭；点面板不关闭（stopPropagation）", () => {
    const props = baseProps();
    const { getByRole, getByText } = render(<ConfirmDialog {...props} />);
    fireEvent.click(getByText("task:confirmDeleteTitle")); // 面板内部
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(getByRole("dialog")); // 遮罩本身
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("deleting：确认按钮 disabled 且出现 spinner；Escape 不关闭", () => {
    const props = baseProps();
    const { getByText } = render(<ConfirmDialog {...props} deleting />);
    const confirmBtn = getByText("task:confirmDelete").closest("button")!;
    expect(confirmBtn.disabled).toBe(true);
    expect(confirmBtn.querySelector("svg.lucide-loader-2")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("非 deleting：Escape 关闭", () => {
    const props = baseProps();
    render(<ConfirmDialog {...props} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("焦点管理", () => {
  it("打开时焦点移入首个可聚焦元素；关闭时恢复先前焦点", () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    const props = baseProps();
    const { unmount } = render(<ConfirmDialog {...props} />);
    // 首个可聚焦 = 取消按钮
    expect((document.activeElement as HTMLElement).textContent).toBe("button:cancel");

    unmount();
    expect(document.activeElement).toBe(outside);
  });

  it("focus trap：Tab 在末元素回卷到首元素，Shift+Tab 在首元素回卷到末元素", () => {
    const props = baseProps();
    const { getByText } = render(<ConfirmDialog {...props} />);
    const cancelBtn = getByText("button:cancel").closest("button")!;
    const confirmBtn = getByText("task:confirmDelete").closest("button")!;

    confirmBtn.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(cancelBtn);

    cancelBtn.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirmBtn);
  });
});
