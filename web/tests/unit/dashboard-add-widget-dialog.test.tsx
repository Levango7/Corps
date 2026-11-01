// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

/**
 * 「添加 Widget」对话框契约（components/dashboard/AddWidgetDialog.tsx）：
 *  - open=false 不渲染；open=true → role=dialog + aria-modal + 标题/关闭按钮
 *  - 列表来自 WIDGET_IDS：每项 = 图标 + 标题 key + 描述 key
 *  - 已添加项灰显 disabled 且用对勾替代加号；未添加项可点
 *  - 点击未添加项 → onAdd(id) 后 onClose；遮罩点击关、面板内点击不关；Escape 关
 *  - 打开时把焦点移入对话框
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

// AddWidgetDialog 经 ./widgets 拉进全部 Widget 组件，其中列表型 Widget 引用
// `@/lib/i18n-navigation`（→ next-intl/navigation → next/navigation，裸 vitest 解析不了）。
vi.mock("@/lib/i18n-navigation", async () => {
  const React = await import("react");
  type LinkProps = { href: string; className?: string; children?: React.ReactNode };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>((props, ref) =>
    React.createElement("a", { href: props.href, className: props.className, ref }, props.children),
  );
  Link.displayName = "MockLink";
  return { Link };
});

import AddWidgetDialog from "@/components/dashboard/AddWidgetDialog";

const baseProps = () => ({
  open: true,
  addedIds: [] as string[],
  onAdd: vi.fn(),
  onClose: vi.fn(),
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("AddWidgetDialog", () => {
  it("open=false：什么都不渲染", () => {
    const { container } = render(<AddWidgetDialog {...baseProps()} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("open=true：role=dialog + aria-modal + 标题，列出全部 11 个 Widget（标题 + 描述）", () => {
    const { getByRole, getByText, container } = render(<AddWidgetDialog {...baseProps()} />);

    const dialog = getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("dashboard:addWidgetTitle");
    expect(getByText("dashboard:addWidgetTitle")).toBeTruthy();
    expect(dialog.querySelector('[aria-label="dashboard:close"]')).toBeTruthy();

    expect(container.querySelectorAll("li").length).toBe(11);
    expect(getByText("dashboard:taskStats")).toBeTruthy();
    expect(getByText("dashboard:taskStatsDesc")).toBeTruthy();
    expect(getByText("dashboard:customChartDesc")).toBeTruthy();
    // 每项都有图标
    expect(container.querySelectorAll("li svg.lucide").length).toBeGreaterThanOrEqual(11);
  });

  it("已添加项：disabled + 灰显 + 对勾；未添加项：可点 + 加号", () => {
    const props = { ...baseProps(), addedIds: ["task-stats"] };
    const { container } = render(<AddWidgetDialog {...props} />);

    const buttons = Array.from(container.querySelectorAll("li button"));
    const addedBtn = buttons.find((b) => b.textContent?.includes("dashboard:taskStats"))!;
    expect((addedBtn as HTMLButtonElement).disabled).toBe(true);
    expect(addedBtn.className).toContain("cursor-not-allowed");
    expect(addedBtn.querySelector("svg.lucide-check")).toBeTruthy();

    const otherBtn = buttons.find((b) => b.textContent?.includes("dashboard:myTasks"))!;
    expect((otherBtn as HTMLButtonElement).disabled).toBe(false);
    expect(otherBtn.querySelector("svg.lucide-plus")).toBeTruthy();
  });

  it("点击未添加项：先 onAdd(id) 再 onClose", () => {
    const props = baseProps();
    const order: string[] = [];
    props.onAdd.mockImplementation(() => order.push("add"));
    props.onClose.mockImplementation(() => order.push("close"));
    const { getByText } = render(<AddWidgetDialog {...props} />);

    fireEvent.click(getByText("dashboard:burndown"));
    expect(props.onAdd).toHaveBeenCalledWith("burndown");
    expect(order).toEqual(["add", "close"]);
  });

  it("已添加项即使被点也不触发 onAdd", () => {
    const props = { ...baseProps(), addedIds: ["burndown"] };
    const { getByText } = render(<AddWidgetDialog {...props} />);
    fireEvent.click(getByText("dashboard:burndown"));
    expect(props.onAdd).not.toHaveBeenCalled();
  });

  it("遮罩点击关闭、面板内点击不关闭", () => {
    const props = baseProps();
    const { getByRole, container } = render(<AddWidgetDialog {...props} />);

    fireEvent.click(getByRole("dialog"));
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape 关闭；关闭状态下不注册监听", () => {
    const props = baseProps();
    const { rerender } = render(<AddWidgetDialog {...props} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    props.onClose.mockClear();
    rerender(<AddWidgetDialog {...props} open={false} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("打开后焦点进入对话框", async () => {
    const { getByRole } = render(<AddWidgetDialog {...baseProps()} />);
    const dialog = getByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
  });

  it("关闭按钮触发 onClose", () => {
    const props = baseProps();
    const { getByRole } = render(<AddWidgetDialog {...props} />);
    fireEvent.click(getByRole("dialog").querySelector('[aria-label="dashboard:close"]')!);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
