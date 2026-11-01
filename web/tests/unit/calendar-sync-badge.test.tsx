// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

/**
 * 日历同步标记契约（components/CalendarSyncBadge.tsx，default export）：
 *  - 拉取 /api/v1/workspaces/{wid}/tasks/{taskId}/calendar-sync
 *  - 加载中：spinner（title=syncing）
 *  - 未同步（synced=false）或空状态：不渲染
 *  - 同步失败（hasError）：AlertTriangle + danger 色，aria-label=syncFailed
 *  - 已同步：Calendar+Check，tooltip=syncedTo（providers 映射 Google/Outlook 并逗号连接）
 *  - 拉取失败：console.warn（R8B-11 不静默吞错）且最终不渲染
 *  - 卸载后完成的请求不更新状态（active 守卫）
 */
const h = vi.hoisted(() => ({ api: vi.fn(), warn: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: h.api }));
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import CalendarSyncBadge from "@/components/CalendarSyncBadge";

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  h.api.mockReset();
  h.warn.mockReset();
  vi.spyOn(console, "warn").mockImplementation(h.warn);
});

describe("CalendarSyncBadge", () => {
  it("加载中：spinner（title=syncing）", () => {
    h.api.mockReturnValue(new Promise(() => {})); // 悬而不决
    const { container } = render(<CalendarSyncBadge wid="w1" taskId="t1" />);
    const spinner = container.querySelector("svg.lucide-loader-2")!;
    expect(spinner).toBeTruthy();
    expect(spinner.parentElement!.getAttribute("title")).toBe("calendar:syncing");
  });

  it("请求路径正确；未同步→不渲染", async () => {
    h.api.mockResolvedValue({ synced: false, providers: [], lastSyncedAt: null, hasError: false });
    const { container } = render(<CalendarSyncBadge wid="w1" taskId="t1" />);
    await flush();
    expect(h.api).toHaveBeenCalledWith("/api/v1/workspaces/w1/tasks/t1/calendar-sync");
    expect(container.firstChild).toBeNull();
  });

  it("同步失败：AlertTriangle + aria-label=syncFailed", async () => {
    h.api.mockResolvedValue({
      synced: true,
      providers: ["google"],
      lastSyncedAt: null,
      hasError: true,
    });
    const { container } = render(<CalendarSyncBadge wid="w1" taskId="t1" />);
    await flush();
    expect(container.querySelector("svg.lucide-alert-triangle")).toBeTruthy();
    expect(container.firstElementChild!.getAttribute("aria-label")).toBe("calendar:syncFailed");
  });

  it("已同步：Calendar+Check，tooltip 映射双 provider 逗号连接", async () => {
    h.api.mockResolvedValue({
      synced: true,
      providers: ["google", "outlook"],
      lastSyncedAt: "2026-01-01T00:00:00Z",
      hasError: false,
    });
    const { container, unmount } = render(<CalendarSyncBadge wid="w1" taskId="t1" />);
    await flush();
    expect(container.querySelector("svg.lucide-calendar")).toBeTruthy();
    expect(container.querySelector("svg.lucide-check")).toBeTruthy();
    const expected = 'calendar:syncedTo:{"provider":"Google Calendar, Outlook Calendar"}';
    expect(container.firstElementChild!.getAttribute("aria-label")).toBe(expected);
    unmount();

    h.api.mockResolvedValue({
      synced: true,
      providers: ["outlook"],
      lastSyncedAt: null,
      hasError: false,
    });
    const b = render(<CalendarSyncBadge wid="w1" taskId="t1" />);
    await flush();
    expect(b.container.firstElementChild!.getAttribute("title")).toBe(
      'calendar:syncedTo:{"provider":"Outlook Calendar"}',
    );
  });

  it("拉取失败：console.warn 记录且不渲染", async () => {
    h.api.mockRejectedValue(new Error("boom"));
    const { container } = render(<CalendarSyncBadge wid="w1" taskId="t1" />);
    await flush();
    expect(h.warn).toHaveBeenCalledWith("[CalendarSyncBadge] 同步状态获取失败:", expect.any(Error));
    expect(container.firstChild).toBeNull();
  });

  it("卸载后完成的请求不更新状态（active 守卫，无 setState 警告）", async () => {
    let resolveApi!: (v: unknown) => void;
    h.api.mockReturnValue(
      new Promise((r) => {
        resolveApi = r;
      }),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<CalendarSyncBadge wid="w1" taskId="t1" />);
    unmount();
    resolveApi({ synced: true, providers: ["google"], lastSyncedAt: null, hasError: false });
    await flush();
    const messages = errSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("state update"))).toBe(false);
    errSpy.mockRestore();
  });
});
