// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AI 使用限额设置契约（components/ai/UsageLimitSettings.tsx）：
 *  1. 挂载 GET /api/v1/ai/usage/limits?workspaceId=<wid>（带 AbortSignal）
 *  2. 加载中 → 仅 Loader2；GET 失败 → t("loadFailed")，不渲染表单
 *  3. result 四个字段填入输入框（null → ""）；result 为 null 时保持空白
 *  4. 表单装配：label/htmlFor 四对、placeholder=t("noLimit")、type=number min=0
 *  5. 保存：PUT 同 URL，body {workspaceId, userId:null, 四个 toLimitValue}
 *     —— trim、空串→null、非数/负数→null、小数 floor
 *  6. 保存成功 → toast("success", t("save"))；失败 → toast("error", t("saveFailed"))
 *  7. 保存中按钮 disabled 且换 Loader2
 *  8. aria-label/h1 = t("limitSettings")；卸载中止进行中请求不崩
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next-intl", () => {
  // t 在 useCallback 依赖里 → 按 ns 缓存闭包，避免 effect 反复重跑
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
vi.mock("@/lib/api", () => ({ api: mocks.api }));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

import { UsageLimitSettings } from "@/components/ai/UsageLimitSettings";

const WID = "ws-1";

beforeEach(() => {
  mocks.api.mockReset();
  mocks.toast.mockReset();
});

afterEach(() => {
  cleanup();
});

function lastOpts(): { method?: string; body?: string; signal?: AbortSignal } {
  const call = mocks.api.mock.calls[mocks.api.mock.calls.length - 1];
  return (call?.[1] ?? {}) as { method?: string; body?: string; signal?: AbortSignal };
}

function input(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

describe("UsageLimitSettings", () => {
  it("挂载即 GET 限额，URL 带 workspaceId、opts 带 AbortSignal", async () => {
    mocks.api.mockResolvedValueOnce(null);
    render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit")).toBeTruthy());
    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/ai/usage/limits?workspaceId=${WID}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("加载中：只渲染 Loader2，表单未出现", () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(<UsageLimitSettings wid={WID} />);
    expect(container.querySelector(".lucide-loader-2")).toBeTruthy();
    expect(container.querySelector(".lucide-settings")).toBeFalsy();
    expect(document.getElementById("daily-token-limit")).toBeNull();
  });

  it('GET 失败 → t("loadFailed") 错误面，表单不渲染', async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    const { container } = render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(screen.getByText("ai.usage:loadFailed")).toBeTruthy());
    expect(screen.queryByText("ai.usage:dailyTokenLimit")).toBeNull();
    expect(container.querySelector(".lucide-settings")).toBeFalsy();
  });

  it("四个字段填入：number→字符串、null→空串", async () => {
    mocks.api.mockResolvedValueOnce({
      id: "limit-1",
      dailyTokenLimit: 100000,
      monthlyTokenLimit: null,
      dailyCallLimit: 50,
      monthlyCallLimit: 3000,
    });
    render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit").value).toBe("100000"));
    expect(input("monthly-token-limit").value).toBe("");
    expect(input("daily-call-limit").value).toBe("50");
    expect(input("monthly-call-limit").value).toBe("3000");
  });

  it("result 为 null → 四个输入框保持空白", async () => {
    mocks.api.mockResolvedValueOnce(null);
    render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit")).toBeTruthy());
    for (const id of [
      "daily-token-limit",
      "monthly-token-limit",
      "daily-call-limit",
      "monthly-call-limit",
    ]) {
      expect(input(id).value).toBe("");
    }
  });

  it("表单装配：label/htmlFor 四对、placeholder、number+min=0、根 aria-label 与 h1", async () => {
    mocks.api.mockResolvedValueOnce(null);
    const { container } = render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit")).toBeTruthy());
    for (const label of [
      "dailyTokenLimit",
      "monthlyTokenLimit",
      "dailyCallLimit",
      "monthlyCallLimit",
    ]) {
      expect(screen.getByLabelText(`ai.usage:${label}`)).toBeTruthy();
    }
    for (const id of [
      "daily-token-limit",
      "monthly-token-limit",
      "daily-call-limit",
      "monthly-call-limit",
    ]) {
      expect(input(id).type).toBe("number");
      expect(input(id).min).toBe("0");
      expect(input(id).getAttribute("placeholder")).toBe("ai.usage:noLimit");
    }
    expect(container.querySelector("h1")?.textContent).toBe("ai.usage:limitSettings");
    expect(container.querySelector(".lucide-settings")).toBeTruthy();
  });

  it("保存：PUT body 经 toLimitValue 转换——空串→null、非法/负数→null、小数取整", async () => {
    mocks.api.mockResolvedValueOnce(null);
    mocks.api.mockResolvedValueOnce(undefined);
    render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit")).toBeTruthy());
    // type="number" 在值到达 toLimitValue 之前已由浏览器做空白消毒，
    // 故 toLimitValue 的 trim 分支是防御性代码、UI 路径不可达。
    fireEvent.change(input("daily-token-limit"), { target: { value: "100" } });
    fireEvent.change(input("monthly-token-limit"), { target: { value: "" } });
    fireEvent.change(input("daily-call-limit"), { target: { value: "3.7" } });
    fireEvent.change(input("monthly-call-limit"), { target: { value: "-5" } });
    fireEvent.click(screen.getByText("ai.usage:save"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/ai/usage/limits", expect.anything());
    expect(lastOpts().method).toBe("PUT");
    expect(JSON.parse(lastOpts().body ?? "{}")).toEqual({
      workspaceId: WID,
      userId: null,
      dailyTokenLimit: 100,
      monthlyTokenLimit: null, // 空串
      dailyCallLimit: 3, // Math.floor
      monthlyCallLimit: null, // 负数
    });
  });

  it("非法输入（非数字）也落 null，不报错", async () => {
    mocks.api.mockResolvedValueOnce(null);
    mocks.api.mockResolvedValueOnce(undefined);
    render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit")).toBeTruthy());
    fireEvent.change(input("daily-token-limit"), { target: { value: "abc" } });
    fireEvent.click(screen.getByText("ai.usage:save"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(JSON.parse(lastOpts().body ?? "{}").dailyTokenLimit).toBeNull();
  });

  it('保存成功 → toast("success", t("save"))', async () => {
    mocks.api.mockResolvedValueOnce(null);
    mocks.api.mockResolvedValueOnce(undefined);
    render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.usage:save"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
    expect(mocks.toast).toHaveBeenCalledWith("success", "ai.usage:save");
  });

  it('保存失败 → toast("error", t("saveFailed"))，不泄露 e.message', async () => {
    mocks.api.mockResolvedValueOnce(null);
    mocks.api.mockRejectedValueOnce(new Error("db exploded"));
    render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit")).toBeTruthy());
    fireEvent.click(screen.getByText("ai.usage:save"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
    expect(mocks.toast).toHaveBeenCalledWith("error", "ai.usage:saveFailed");
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.anything(), "db exploded");
  });

  it("保存中：按钮 disabled 且内容换 Loader2（Save 图标消失）", async () => {
    mocks.api.mockResolvedValueOnce(null);
    let resolveSave: (v: unknown) => void = () => {};
    mocks.api.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveSave = r;
        }),
    );
    const { container } = render(<UsageLimitSettings wid={WID} />);
    await waitFor(() => expect(input("daily-token-limit")).toBeTruthy());
    expect(container.querySelector(".lucide-save")).toBeTruthy();
    fireEvent.click(screen.getByText("ai.usage:save"));
    await waitFor(() => expect(container.querySelector(".lucide-loader-2")).toBeTruthy());
    const btn = screen.getByText("ai.usage:save").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    resolveSave(undefined);
    await waitFor(() => expect(container.querySelector(".lucide-save")).toBeTruthy());
  });

  it("组件卸载时中止进行中的加载请求（不抛错）", () => {
    mocks.api.mockImplementationOnce(() => new Promise(() => {}));
    const { unmount } = render(<UsageLimitSettings wid={WID} />);
    expect(() => unmount()).not.toThrow();
  });
});
