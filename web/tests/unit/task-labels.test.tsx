// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { TaskLabels } from "@/components/TaskLabels";

/**
 * 任务标签展示契约（components/TaskLabels.tsx）：
 *  - 空/未传 labels → 不渲染
 *  - 最多展示 max 个（默认 3），超出显示 "+N"
 *  - 每个标签：色点（aria-hidden）+ 名称；颜色用 color-mix 稀释背景 + 原色文字（无裸 hex 类名）
 *  - 自定义 max 生效
 */
const label = (id: string, name: string, color = "rgb(59, 130, 246)") =>
  ({ id, name, color }) as never;

describe("TaskLabels", () => {
  it("空数组 / 未传 → 不渲染任何节点", () => {
    expect(render(<TaskLabels labels={[]} />).container.firstChild).toBeNull();
    expect(render(<TaskLabels labels={undefined as never} />).container.firstChild).toBeNull();
  });

  it("≤3 个：全部展示，无 +N", () => {
    const { container, getByText, queryByText } = render(
      <TaskLabels labels={[label("a", "前端"), label("b", "后端")]} />,
    );
    expect(getByText("前端")).toBeTruthy();
    expect(getByText("后端")).toBeTruthy();
    expect(queryByText(/^\+\d/)).toBeNull();
    // 色点带 aria-hidden（装饰性）
    expect(container.querySelectorAll('span[aria-hidden="true"]').length).toBe(2);
  });

  it("超过 3 个：只展示前 3 个 + '+N' 溢出提示", () => {
    const labels = [
      label("a", "前端"),
      label("b", "后端"),
      label("c", "测试"),
      label("d", "运维"),
      label("e", "设计"),
    ];
    const { getByText, queryByText } = render(<TaskLabels labels={labels} />);
    expect(getByText("前端")).toBeTruthy();
    expect(getByText("测试")).toBeTruthy();
    expect(queryByText("运维")).toBeNull();
    expect(getByText("+2")).toBeTruthy();
  });

  it("自定义 max 生效（max=1 → 显示 1 个 + 溢出数）", () => {
    const labels = [label("a", "前端"), label("b", "后端"), label("c", "测试")];
    const { getByText, queryByText } = render(<TaskLabels labels={labels} max={1} />);
    expect(getByText("前端")).toBeTruthy();
    expect(queryByText("后端")).toBeNull();
    expect(getByText("+2")).toBeTruthy();
  });

  it("颜色：背景走 color-mix 稀释、文字/色点用标签色（样式走 inline style，不写死类名）", () => {
    const { container } = render(<TaskLabels labels={[label("a", "前端", "rgb(255, 0, 0)")]} />);
    const chip = container.querySelector('span[aria-hidden="true"]')!.parentElement as HTMLElement;
    expect(chip.style.background).toContain("color-mix");
    expect(chip.style.color).toBe("rgb(255, 0, 0)");
    const dot = chip.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot.style.background).toBe("rgb(255, 0, 0)");
  });
});
