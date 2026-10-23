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
 */

const h = vi.hoisted(() => ({
  calls: [] as { url: string; init?: { method?: string; body?: string } }[],
}));

vi.mock("@/lib/api", () => ({
  api: async (url: string, init?: { method?: string; body?: string }) => {
    h.calls.push({ url, init });
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
});
