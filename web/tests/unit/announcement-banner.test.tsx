// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AnnouncementBanner 契约（components/announcement/AnnouncementBanner.tsx）：
 *  1. 挂载即 GET /api/v1/workspaces/{wid}/announcements?pinned=true&limit=10
 *  2. 读取 localStorage dismissed-announcements-{wid}，过滤已关闭公告后展示第一条
 *  3. 无可见公告 / 请求失败 / localStorage 值损坏 → 容错（渲染 null 或忽略坏值）
 *  4. 徽章文案 t(type)（announcement:info|warning|urgent），图标按类型切换
 *  5. content 去除 Markdown 标记字符并截断 120 字符
 *  6. dismiss：公告 id 写入 localStorage 并隐藏；重挂载后不再出现
 *  7. wid 变化 → 按新 wid 重新拉取
 */

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock("next-intl", () => {
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

import { AnnouncementBanner } from "@/components/announcement/AnnouncementBanner";
import type { AnnouncementItem } from "@/components/announcement/AnnouncementEditor";

const WID = "ws-ab-1";
const DISMISSED_KEY = `dismissed-announcements-${WID}`;

/** jsdom 未内置 localStorage：装最小内存桩（window 与裸全局各一份引用，组件两种取法都命中） */
function installLocalStorageStub() {
  const store = new Map<string, string>();
  const stub = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  } as unknown as Storage;
  Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
}

function mkAnnouncement(overrides: Partial<AnnouncementItem> = {}): AnnouncementItem {
  return {
    id: "ann-1",
    title: "系统维护通知",
    content: "周六 02:00-04:00 进行系统维护",
    type: "info",
    targetAudience: { type: "all" },
    pinned: true,
    publishedBy: null,
    publishedAt: "2026-10-01T10:00:00.000Z",
    expiresAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    publisher: { id: "u1", name: "管理员", email: "admin@corp.dev" },
    ...overrides,
  };
}

const bannerRoot = () => screen.queryByRole("status");

/** 等待一次拉取落定（banner 渲染或被过滤）后再断言“无横幅”，避免空窗期误判 */
async function settledNoBanner() {
  await waitFor(() => expect(mocks.api).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(bannerRoot()).toBeNull();
}

beforeEach(() => {
  mocks.api.mockReset();
  installLocalStorageStub();
});
afterEach(() => cleanup());

describe("AnnouncementBanner", () => {
  it("请求 URL 精确（pinned=true&limit=10）；items 为空时不渲染任何横幅", async () => {
    mocks.api.mockResolvedValueOnce({ items: [] });
    render(<AnnouncementBanner wid={WID} />);

    expect(mocks.api).toHaveBeenCalledWith(
      `/api/v1/workspaces/${WID}/announcements?pinned=true&limit=10`,
    );
    await settledNoBanner();
  });

  it("成功渲染 info 公告：role=status、aria-live、类型徽章、标题、摘要与图标", async () => {
    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement()] });
    const { container } = render(<AnnouncementBanner wid={WID} />);

    const banner = await screen.findByRole("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("announcement:info")).toBeInTheDocument();
    expect(screen.getByText("系统维护通知")).toBeInTheDocument();
    expect(screen.getByText("周六 02:00-04:00 进行系统维护")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-info")).toBeTruthy();
    expect(container.querySelector("svg.lucide-megaphone")).toBeTruthy();
  });

  it("warning 类型：AlertTriangle 图标 + announcement:warning 徽章", async () => {
    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement({ type: "warning" })] });
    const { container } = render(<AnnouncementBanner wid={WID} />);

    await screen.findByRole("status");
    expect(container.querySelector("svg.lucide-alert-triangle")).toBeTruthy();
    expect(screen.getByText("announcement:warning")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-info")).toBeNull();
  });

  it("urgent 类型：AlertOctagon 图标 + announcement:urgent 徽章", async () => {
    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement({ type: "urgent" })] });
    const { container } = render(<AnnouncementBanner wid={WID} />);

    await screen.findByRole("status");
    expect(container.querySelector("svg.lucide-alert-octagon")).toBeTruthy();
    expect(screen.getByText("announcement:urgent")).toBeInTheDocument();
  });

  it("content 剥离 Markdown 标记字符；超过 120 字符截断", async () => {
    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement({ content: "#维护\n紧急事项" })] });
    const first = render(<AnnouncementBanner wid={WID} />);
    await screen.findByRole("status");
    expect(screen.getByText("维护 紧急事项")).toBeInTheDocument();
    first.unmount();

    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement({ content: "x".repeat(130) })] });
    render(<AnnouncementBanner wid={WID} />);
    await screen.findByRole("status");
    expect(screen.getByText("x".repeat(120))).toBeInTheDocument();
    expect(screen.queryByText("x".repeat(130))).toBeNull();
  });

  it("已关闭公告被过滤：显示剩余第一条；全部关闭则不渲染", async () => {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(["ann-1"]));
    mocks.api.mockResolvedValueOnce({
      items: [
        mkAnnouncement({ id: "ann-1", title: "公告甲" }),
        mkAnnouncement({ id: "ann-2", title: "公告乙" }),
      ],
    });
    const first = render(<AnnouncementBanner wid={WID} />);
    await screen.findByText("公告乙");
    expect(screen.queryByText("公告甲")).toBeNull();
    first.unmount();

    localStorage.setItem(DISMISSED_KEY, JSON.stringify(["ann-1", "ann-2"]));
    mocks.api.mockResolvedValueOnce({
      items: [mkAnnouncement({ id: "ann-1" }), mkAnnouncement({ id: "ann-2" })],
    });
    render(<AnnouncementBanner wid={WID} />);
    await settledNoBanner();
  });

  it("localStorage 值损坏（非法 JSON）时容错：仍显示第一条", async () => {
    localStorage.setItem(DISMISSED_KEY, "{broken json");
    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement()] });
    render(<AnnouncementBanner wid={WID} />);

    await screen.findByRole("status");
    expect(screen.getByText("系统维护通知")).toBeInTheDocument();
  });

  it("dismiss：公告 id 写入 localStorage 并隐藏横幅", async () => {
    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement()] });
    render(<AnnouncementBanner wid={WID} />);
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "announcement:dismiss" }));

    expect(bannerRoot()).toBeNull();
    expect(JSON.parse(localStorage.getItem(DISMISSED_KEY)!)).toEqual(["ann-1"]);
  });

  it("dismiss 后重挂载不再显示（localStorage 记忆生效）", async () => {
    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement()] });
    const first = render(<AnnouncementBanner wid={WID} />);
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "announcement:dismiss" }));
    first.unmount();

    mocks.api.mockResolvedValueOnce({ items: [mkAnnouncement()] });
    render(<AnnouncementBanner wid={WID} />);
    await settledNoBanner();
  });

  it("请求失败 → 不渲染横幅", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    render(<AnnouncementBanner wid={WID} />);

    await settledNoBanner();
  });

  it("wid 变化 → 按新 wid 重新拉取并渲染对应公告", async () => {
    mocks.api
      .mockResolvedValueOnce({ items: [mkAnnouncement({ id: "a1", title: "第一条" })] })
      .mockResolvedValueOnce({ items: [mkAnnouncement({ id: "a2", title: "第二条" })] });
    const { rerender } = render(<AnnouncementBanner wid={WID} />);
    await screen.findByText("第一条");

    rerender(<AnnouncementBanner wid="ws-ab-2" />);
    await screen.findByText("第二条");
    expect(mocks.api).toHaveBeenLastCalledWith(
      "/api/v1/workspaces/ws-ab-2/announcements?pinned=true&limit=10",
    );
  });
});
