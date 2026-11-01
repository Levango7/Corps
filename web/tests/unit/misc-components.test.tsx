// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

/**
 * 三个小件契约：
 *  - Logo：SVG 品牌标记（role=img + aria-label=corps）+ 可选文字；size/className 透传
 *  - SettingsOverview：工作区概况（成员数/任务数/套餐/创建时间/工作区 ID），纯展示
 *  - IMBadge：**30s 轮询未读数**、>99 显示 99+、0 不显示徽标、点击跳 /w/{wid}/im、
 *    拉取失败静默（保持 0）、卸载清定时器、aria-label 走 chat:title
 */
const h = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: h.api }));
vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ push: h.push }),
  usePathname: () => "/",
}));
vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
  useLocale: () => "zh",
}));

import { Logo } from "@/components/Logo";
import { SettingsOverview } from "@/components/settings/SettingsOverview";
import { IMBadge } from "@/components/shell/IMBadge";

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  h.api.mockReset();
  h.push.mockReset();
  h.api.mockResolvedValue({ totalUnread: 0, byConversation: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Logo", () => {
  it("默认：SVG（role=img/aria-label=corps）+ 文字 'corps'", () => {
    const { container, getByText } = render(<Logo />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("corps");
    expect(svg.getAttribute("width")).toBe("24");
    expect(getByText("corps")).toBeTruthy();
  });

  it("withText=false 只出图形；size 与 className 透传", () => {
    const { container } = render(<Logo withText={false} size={32} className="extra-cls" />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("32");
    expect(container.firstElementChild!.className).toContain("extra-cls");
  });
});

describe("SettingsOverview", () => {
  const ws = {
    id: "ws-123",
    memberCount: 7,
    taskCount: 42,
    plan: "pro",
    createdAt: "2026-01-02T00:00:00Z",
  } as never;

  it("渲染五要素：成员数/任务数/套餐/创建时间/工作区 ID", () => {
    const { container, getByText } = render(<SettingsOverview ws={ws} />);
    expect(getByText("settings:overviewTitle")).toBeTruthy();
    expect(container.textContent).toContain("7 settings:overviewMembersUnit");
    expect(container.textContent).toContain("42 settings:overviewTasksUnit");
    expect(getByText("pro")).toBeTruthy();
    // 创建时间按 locale（zh）格式化
    expect(container.textContent).toContain(
      new Date("2026-01-02T00:00:00Z").toLocaleDateString("zh"),
    );
    expect(getByText("ws-123")).toBeTruthy();
  });
});

describe("IMBadge", () => {
  it("初始拉取：有未读显示数字；aria-label=chat:title", async () => {
    h.api.mockResolvedValue({ totalUnread: 5, byConversation: [] });
    const { container, getByRole } = render(<IMBadge workspaceId="w1" />);
    await flush();
    expect(h.api).toHaveBeenCalledWith("/api/v1/workspaces/w1/conversations/unread-count");
    expect(container.textContent).toContain("5");
    expect(getByRole("button").getAttribute("aria-label")).toBe("chat:title");
    expect(container.querySelector("svg.lucide-message-square")).toBeTruthy();
  });

  it("未读为 0：不渲染徽标文本", async () => {
    h.api.mockResolvedValue({ totalUnread: 0, byConversation: [] });
    const { container } = render(<IMBadge workspaceId="w1" />);
    await flush();
    expect(container.querySelector("span.absolute")).toBeNull();
  });

  it(">99 显示 99+（恰好 99 显示 99）", async () => {
    h.api.mockResolvedValue({ totalUnread: 123, byConversation: [] });
    const a = render(<IMBadge workspaceId="w1" />);
    await flush();
    expect(a.container.textContent).toContain("99+");
    a.unmount();

    h.api.mockResolvedValue({ totalUnread: 99, byConversation: [] });
    const b = render(<IMBadge workspaceId="w1" />);
    await flush();
    expect(b.container.textContent).toContain("99");
    expect(b.container.textContent).not.toContain("99+");
  });

  it("30s 轮询：假时钟推进后再次拉取；卸载后停止", async () => {
    vi.useFakeTimers();
    const { unmount } = render(<IMBadge workspaceId="w1" />);
    await flush();
    expect(h.api).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await flush();
    expect(h.api).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(90_000);
    });
    expect(h.api).toHaveBeenCalledTimes(2); // 定时器已清
  });

  it("拉取失败：静默保持 0（不抛）", async () => {
    h.api.mockRejectedValue(new Error("boom"));
    const { container } = render(<IMBadge workspaceId="w1" />);
    await flush();
    expect(container.querySelector("span.absolute")).toBeNull();
  });

  it("点击：跳转 /w/{wid}/im", async () => {
    const { getByRole } = render(<IMBadge workspaceId="w9" />);
    await flush();
    fireEvent.click(getByRole("button"));
    expect(h.push).toHaveBeenCalledWith("/w/w9/im");
  });
});
