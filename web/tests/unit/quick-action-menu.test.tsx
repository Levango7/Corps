// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { forwardRef, type ReactNode, type HTMLAttributes } from "react";
import { Trash2, Edit3 } from "lucide-react";

/**
 * QuickActionMenu 契约（components/QuickActionMenu.tsx）：
 *  - 挂载后经 createPortal 渲染到 document.body；open=false 不渲染
 *  - actions 渲染为按钮；点击 → action.onClick + onClose
 *  - Esc 关闭；挂载延迟一拍后 pointerdown 菜单外关闭、菜单内不关闭
 *  - danger action 带 danger 文本色
 *  - 定位：style.left/top = x/y（fixed）
 *  - 焦点管理：打开聚焦首个 action；Tab 循环；关闭恢复打开前焦点
 *  - listener 清理：关闭后 Esc/pointerdown 不再触发 onClose
 */

// framer-motion 无动画引擎：mock 成透传节点（motion.div 需转发 ref 供外部点击判定/焦点圈定）
vi.mock("framer-motion", () => ({
  motion: {
    div: forwardRef<HTMLDivElement, { children?: ReactNode; [k: string]: unknown }>(
      // 索引签名会让解构出的具名属性退化为 unknown，先整包断言再取字段
      function MockMotionDiv(props, ref) {
        const children = props.children as ReactNode;
        const { children: _omitted, ...rest } = props;
        return (
          <div ref={ref} {...(rest as HTMLAttributes<HTMLDivElement>)}>
            {children}
          </div>
        );
      },
    ),
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import { QuickActionMenu, type QuickAction } from "@/components/QuickActionMenu";

// onClick 需保留 mock 能力（mockClear），用交叉类型收窄
type MockableAction = QuickAction & { onClick: ReturnType<typeof vi.fn> };
const ACTIONS: MockableAction[] = [
  { icon: Edit3, label: "重命名", onClick: vi.fn() },
  { icon: Trash2, label: "删除", onClick: vi.fn(), danger: true },
];

type MenuProps = Parameters<typeof QuickActionMenu>[0];

function renderMenu(overrides: Partial<MenuProps> = {}) {
  const props: MenuProps = {
    open: true,
    onClose: vi.fn(),
    actions: ACTIONS,
    x: 120,
    y: 80,
    ...overrides,
  };
  return render(<QuickActionMenu {...props} />);
}

/** 外部点击监听是 setTimeout(0) 延迟绑定的：先等它挂上再断言 */
const flushTimers = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  for (const a of ACTIONS) a.onClick.mockClear();
});
afterEach(() => cleanup());

describe("QuickActionMenu", () => {
  it("open=false → 不渲染菜单（portal 为空）", () => {
    renderMenu({ open: false });
    expect(screen.queryByText("重命名")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });

  it("open=true → 菜单 portal 到 document.body（渲染容器内无按钮）", () => {
    const { container } = renderMenu();
    expect(container.querySelector("button")).toBeNull();
    expect(screen.getByRole("button", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("点击 action → 该 action.onClick 与 onClose 各调用一次（互不影响其他 action）", () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    expect(ACTIONS[0].onClick).toHaveBeenCalledTimes(1);
    expect(ACTIONS[1].onClick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc → onClose", () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("外部点击延迟绑定完成后：pointerdown 菜单外 → onClose", async () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    await flushTimers();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pointerdown 落在菜单内 → 不关闭", async () => {
    const onClose = vi.fn();
    renderMenu({ onClose });
    await flushTimers();
    fireEvent.pointerDown(screen.getByRole("button", { name: "删除" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("danger action 带 danger 文色类，普通 action 不带", () => {
    renderMenu();
    const del = screen.getByRole("button", { name: "删除" });
    const rename = screen.getByRole("button", { name: "重命名" });
    expect(del.className).toContain("text-[var(--danger)]");
    expect(rename.className).not.toContain("text-[var(--danger)]");
  });

  it("按 x/y 定位（fixed 坐标透传到 portal 节点）", () => {
    renderMenu({ x: 300, y: 200 });
    // 按钮（portal 内容）的直接父级就是菜单节点
    const menu = screen.getByRole("button", { name: "重命名" }).parentElement!;
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.left).toBe("300px");
    expect(menu.style.top).toBe("200px");
  });

  it("打开时自动聚焦第一个 action（真实生命周期：先挂载 open=false 再翻 true）", () => {
    // 源码行为：首帧 open=true 时 mounted 尚为 false，[open] 副作用在菜单未挂载时跑过一次，
    // 初始聚焦只在 open 由 false→true 的转换时生效——与应用内「先挂载后打开」的用法一致。
    const onClose = vi.fn();
    const { rerender } = renderMenu({ open: false, onClose });
    rerender(<QuickActionMenu open onClose={onClose} actions={ACTIONS} x={120} y={80} />);
    expect(screen.getByRole("button", { name: "重命名" })).toHaveFocus();
  });

  it("Tab 循环：焦点在最后一个 action 按 Tab → 回到第一个", () => {
    renderMenu();
    const first = screen.getByRole("button", { name: "重命名" });
    const last = screen.getByRole("button", { name: "删除" });
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(first).toHaveFocus();
  });

  it("Shift+Tab 循环：焦点在第一个 action 按 Shift+Tab → 跳到最后一个", () => {
    renderMenu();
    const first = screen.getByRole("button", { name: "重命名" });
    const last = screen.getByRole("button", { name: "删除" });
    first.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("关闭后 listener 清理：Esc 与外部 pointerdown 不再触发 onClose", async () => {
    const onClose = vi.fn();
    const { rerender } = renderMenu({ onClose });
    rerender(<QuickActionMenu open={false} onClose={onClose} actions={ACTIONS} x={120} y={80} />);
    await flushTimers();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("关闭时恢复焦点到打开前所在元素", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">外部触发</button>
        <QuickActionMenu open={false} onClose={onClose} actions={ACTIONS} x={0} y={0} />
      </>,
    );
    const trigger = screen.getByText("外部触发");
    trigger.focus();
    rerender(
      <>
        <button type="button">外部触发</button>
        <QuickActionMenu open onClose={onClose} actions={ACTIONS} x={0} y={0} />
      </>,
    );
    expect(screen.getByRole("button", { name: "重命名" })).toHaveFocus();
    rerender(
      <>
        <button type="button">外部触发</button>
        <QuickActionMenu open={false} onClose={onClose} actions={ACTIONS} x={0} y={0} />
      </>,
    );
    expect(trigger).toHaveFocus();
  });
});
