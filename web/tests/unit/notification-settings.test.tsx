// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * 通知偏好面板（NotificationSettings）的**文案诚实性**守卫
 *
 * 为什么盯文案而不是功能：2026-10-01 取证结论是这三组开关是空开关 ——
 * 写库通路完整（PATCH → prisma.notificationPreference.upsert），
 * 但 DB → 行为通路为 0（isDndActive 生产零调用；唯一查 DND 的 offline-push.ts
 * 整模块无人引用；24 处 Notification 落库点不查偏好）。
 * 于是面板原文"在此时段内不发送邮件通知"是一句主动的虚假承诺：用户拨了开关会以为静音了，
 * 实际邮件照发。接线是后话（要跨 24 个落库点且本机验不了），本测试先把"不许撒谎"钉住。
 *
 * i18n mock 按 zh.json 展平查表返回**真实中文**，所以这里断言的是用户实际看到的句子，
 * 不是键名 —— 换成别的键、或有人把文案改回裸承诺，都会红。
 */

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
const { zhFlat } = vi.hoisted(() => {
  const req = process
    .getBuiltinModule("module")
    .createRequire(process.cwd() + "/tests/unit/notification-settings.test.tsx");
  const zh = req("../../messages/zh.json");
  const flat: Record<string, string> = {};
  const walk = (o: unknown, p = "") => {
    if (typeof o !== "object" || o === null) return;
    for (const [k, v] of Object.entries(o)) {
      const np = p ? `${p}.${k}` : k;
      if (typeof v === "object" && v !== null) walk(v, np);
      else flat[np] = String(v);
    }
  };
  walk(zh, "");
  return { zhFlat: flat };
});

vi.mock("next-intl", () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  useTranslations: (ns: string) => (key: string) => zhFlat[`${ns}.${key}`] ?? key,
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiList: (path: string, opts?: RequestInit) => Promise.resolve(apiMock(path, opts) as never),
  ApiError: class ApiError extends Error {
    constructor(
      msg: string,
      public status: number,
    ) {
      super(msg);
    }
  },
}));

import { NotificationSettings } from "@/components/notifications/NotificationSettings";

const PREF = {
  id: "p1",
  emailNotify: true,
  pushNotify: false,
  dndEnabled: true,
  dndStart: "22:00",
  dndEnd: "08:00",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, opts?: RequestInit) => {
    if (String(opts?.method) === "PATCH") return Promise.resolve(PREF);
    return Promise.resolve(PREF);
  });
});
afterEach(() => cleanup());

describe("NotificationSettings 文案诚实性", () => {
  it("渲染时明说这些开关尚未影响实际投递", async () => {
    render(<NotificationSettings />);
    const notice = zhFlat["notifications.notEnforced"];
    expect(notice).toContain("尚未影响");
    await waitFor(() => expect(screen.getByText(notice)).toBeInTheDocument());
  });

  it("免打扰提示语不得再出现裸承诺「在此时段内不发送邮件通知」", async () => {
    render(<NotificationSettings />);
    const hint = zhFlat["notifications.dndHint"];
    expect(hint).not.toMatch(/^在此时段内不发送邮件通知$/);
    expect(hint).toContain("意图");
    await waitFor(() => expect(screen.getByText(hint)).toBeInTheDocument());
  });

  it("三个开关都渲染（说明缺的是接线、不是 UI）", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(3);
    });
  });

  it("未接线前开关与时段输入必须只读（UI 不能假装可控）", async () => {
    render(<NotificationSettings />);
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(3));
    for (const sw of screen.getAllByRole("switch")) {
      expect(sw).toBeDisabled();
      expect(sw).toHaveAttribute("aria-disabled", "true");
    }
    // 免打扰时段随开关一起只读（fixture 里 dndEnabled=true，所以输入框会渲染）
    expect(document.querySelectorAll("#dnd-start[disabled], #dnd-end[disabled]").length).toBe(2);
  });

  it("点保存确实把 dnd 三项发给服务端（写库通路完整）", async () => {
    render(<NotificationSettings />);
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(3));
    const saveBtn = screen.getByRole("button", { name: new RegExp(zhFlat["notifications.save"]) });
    fireEvent.click(saveBtn);
    await waitFor(() => {
      const call = apiMock.mock.calls.find(
        (c) =>
          String(c[1]?.method) === "PATCH" && String(c[0]).includes("/notifications/preferences"),
      );
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body).toMatchObject({ dndEnabled: true, dndStart: "22:00", dndEnd: "08:00" });
    });
  });

  it("卸载必须清掉「已保存」定时器（这是全绿却 rc=1 的根因）", async () => {
    // 症状：jsdom 先拆除、2 秒后定时器才回调 setSaved，react-dom 摸已失效的
    // window → 未捕获异常，vitest 整体退出码 1，而用例全 passed。
    const setSpy = vi.spyOn(globalThis, "setTimeout");
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<NotificationSettings />);
    await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThanOrEqual(3));

    const timerCountBefore = setSpy.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(zhFlat["notifications.save"]) }));
    await waitFor(() =>
      expect(apiMock.mock.calls.some((c) => String(c[1]?.method) === "PATCH")).toBe(true),
    );

    // waitFor 自己也会起定时器，所以只取「点保存之后」新调度的那一批再求交集
    const scheduledAfterSave = setSpy.mock.results
      .slice(timerCountBefore)
      .map((r) => r.value as unknown);
    expect(scheduledAfterSave.length).toBeGreaterThan(0);

    clearSpy.mockClear();
    unmount();
    const cleared = clearSpy.mock.calls.map(([id]) => id as unknown);
    expect(cleared.some((id) => scheduledAfterSave.includes(id))).toBe(true);

    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
