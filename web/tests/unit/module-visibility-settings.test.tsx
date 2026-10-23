// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import zh from "../../messages/zh.json";
import { OPTIONAL_MODULE_IDS } from "@/lib/modules/registry";
import { ModuleVisibilitySettings } from "@/components/settings/ModuleVisibilitySettings";

/**
 * 设置页「侧栏模块」开关（P1-B2）的交互测试。
 *
 * 钉两件事：
 *  - 开关数量 = 可选模块数（不是 31，也不是 10）——数量漂移会让首屏杠杆失效；
 *  - 非 owner 看到的是**只读**（disabled + 说明），不是"能点但存不上"。
 *
 * 补强（第二轮）：
 *  - **控件的可读名称必须与可见文案同源**。本轮真正的 bug 形态是「控件有可见
 *    label、读屏却拿不到名字」：`control-has-associated-label` 只看控件自身的
 *    子树与 aria-*、从不回溯祖先，所以 `<label>` 包着控件照样判红，必须显式补
 *    aria-label。这里把「读屏拿到的名字 == 用户看到的名字」钉死，
 *    顺带挡住「aria-label 写死成别的文案/被删掉」两种回退。
 *  - 保存失败要**可播报**（role=alert），且成功/失败提示互斥。
 */

const h = vi.hoisted(() => ({
  calls: [] as { url: string; init?: { method?: string; body?: string } }[],
  failMessage: null as string | null,
}));

vi.mock("@/lib/api", () => ({
  api: async (url: string, init?: { method?: string; body?: string }) => {
    h.calls.push({ url, init });
    if (h.failMessage !== null) throw new Error(h.failMessage);
    return {};
  },
}));

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="zh" messages={zh}>
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  h.calls.length = 0;
  h.failMessage = null;
});

describe("ModuleVisibilitySettings", () => {
  it("渲染与可选模块数一致的开关（不多不少）", () => {
    const { container } = wrap(
      <ModuleVisibilitySettings wid="w1" role="owner" initialEnabled={[]} />,
    );
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      OPTIONAL_MODULE_IDS.length,
    );
  });

  it("owner 勾选后保存：PATCH 到正确路由，body 是完整启用集合", async () => {
    const { container, getByRole } = wrap(
      <ModuleVisibilitySettings wid="w1" role="owner" initialEnabled={[]} />,
    );
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    fireEvent.click(boxes[0]);

    fireEvent.click(getByRole("button", { name: /保存模块设置/ }));

    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.calls[0].url).toBe("/api/v1/workspaces/w1/settings/modules");
    expect(h.calls[0].init?.method).toBe("PATCH");
    const body = JSON.parse(h.calls[0].init?.body ?? "{}") as { enabledModules: string[] };
    expect(body.enabledModules).toEqual([OPTIONAL_MODULE_IDS[0]]);
  });

  it("非 owner：控件只读且给出说明，不渲染保存按钮", () => {
    const { container, getByText, queryByRole } = wrap(
      <ModuleVisibilitySettings wid="w1" role="admin" initialEnabled={["wiki"]} />,
    );
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...boxes].every((b) => b.disabled)).toBe(true);
    expect(getByText("仅工作区所有者可以修改")).toBeTruthy();
    expect(queryByRole("button", { name: /保存模块设置/ })).toBeNull();
  });

  it("初始启用项按传入值勾上（来自服务端收口后的列表）", () => {
    const { container } = wrap(
      <ModuleVisibilitySettings wid="w1" role="owner" initialEnabled={["wiki"]} />,
    );
    const checked = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .filter((b) => b.checked)
      .map((b) => b.getAttribute("aria-label"));
    expect(checked).toEqual([zh.nav.menu.wiki]);
  });

  it("每个开关的 aria-label 非空、且与它自己的可见文案同源", () => {
    // 这条守的是一整类 bug：控件有可见 label，读屏却拿不到名字。
    // 断言「读屏读到的 == 用户看到的」，任何一方被改/被删都会立刻红。
    const { container } = wrap(
      <ModuleVisibilitySettings wid="w1" role="owner" initialEnabled={[]} />,
    );
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(OPTIONAL_MODULE_IDS.length);

    const labels = boxes.map((b) => {
      const aria = b.getAttribute("aria-label");
      expect(aria).toBeTruthy();
      // 可见文案取自同一个 li 的文本（图标是 aria-hidden，不贡献文本）
      expect(b.closest("li")?.textContent?.trim()).toBe(aria);
      return aria as string;
    });

    // 名称不重复：两个模块同名会让读屏列表里出现无法区分的项
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("保存失败：错误可播报（role=alert），且不与「已保存」同时出现", async () => {
    h.failMessage = "网络异常";
    const { getByRole, queryByText } = wrap(
      <ModuleVisibilitySettings wid="w1" role="owner" initialEnabled={["wiki"]} />,
    );
    fireEvent.click(getByRole("button", { name: /保存模块设置/ }));

    await waitFor(() => expect(getByRole("alert")).toBeTruthy());
    expect(getByRole("alert").textContent).toBe("网络异常");
    expect(queryByText("已保存")).toBeNull();
  });
});
