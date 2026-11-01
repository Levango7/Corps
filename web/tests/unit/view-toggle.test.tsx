// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import { ViewToggle } from "@/components/ViewToggle";

/**
 * 看板视图切换按钮组契约（components/ViewToggle.tsx + ViewToggleClient.tsx）：
 *  - role=group + aria-label（viewAria）
 *  - 两个按钮：看板/列表，aria-pressed 反映当前视图，aria-label 走传入文案
 *  - 点击回调 onChange("board"/"list")；当前项再次点击也会回调（幂等由使用者决定）
 *  - 文案在 sm 起显示（hidden sm:inline），图标始终显示（Kanban/List）
 */
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));

const setup = (view: "board" | "list" = "board") => {
  const onChange = vi.fn();
  const utils = render(<ViewToggle view={view} onChange={onChange} />);
  return { onChange, ...utils };
};

describe("ViewToggle", () => {
  it("容器 role=group + aria-label", () => {
    const { getByRole } = setup();
    const group = getByRole("group");
    expect(group.getAttribute("aria-label")).toBe("task:viewAria");
  });

  it("两个按钮：看板/列表，aria-label 与文案来自 task 命名空间", () => {
    const { getByRole } = setup("board");
    const boardBtn = getByRole("button", { name: "task:boardViewAria" });
    const listBtn = getByRole("button", { name: "task:listViewAria" });
    expect(boardBtn.textContent).toContain("task:boardView");
    expect(listBtn.textContent).toContain("task:listView");
    // 文案只在 sm 起显示（响应式类），图标始终在
    expect(boardBtn.querySelector("span")!.className).toContain("hidden");
    expect(boardBtn.querySelector("svg")).toBeTruthy();
  });

  it("aria-pressed 反映当前视图（board / list 两种）", () => {
    const b = setup("board");
    expect(b.getByRole("button", { name: "task:boardViewAria" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(b.getByRole("button", { name: "task:listViewAria" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    b.unmount();

    const l = setup("list");
    expect(l.getByRole("button", { name: "task:listViewAria" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(l.getByRole("button", { name: "task:boardViewAria" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("点击回调：board / list 各自 onChange", () => {
    const { onChange, getByRole } = setup("board");
    fireEvent.click(getByRole("button", { name: "task:listViewAria" }));
    expect(onChange).toHaveBeenCalledWith("list");
    fireEvent.click(getByRole("button", { name: "task:boardViewAria" }));
    expect(onChange).toHaveBeenCalledWith("board");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
