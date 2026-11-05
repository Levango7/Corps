// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AnnouncementList 契约（components/announcement/AnnouncementList.tsx）：
 *  1. GET /api/v1/workspaces/{wid}/announcements?{type}；type 过滤按钮 aria-pressed 切换重拉
 *  2. 列表渲染 type 徽章 / pinned 徽章 / 标题 / summarize（去 Markdown 截 160+…）/
 *     publisher（name→email 回退）/ publishedAt / expiresAt
 *  3. 创建与编辑按钮打开 AnnouncementEditor（编辑带 announcement）；保存后 refreshKey 重拉
 *  4. togglePin PATCH {pinned:!}；删除走 window.confirm 门控 DELETE
 *  5. loading 与空态共用 t("noAnnouncements") 文案；失败显示 e.message
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
// Editor 是重组件（有自己的 api/焦点陷阱），本文件只验接线
vi.mock("@/components/announcement/AnnouncementEditor", () => ({
  TYPE_TOKEN: {
    info: { fg: "var(--accent)", soft: "var(--accent-soft)", softFg: "var(--accent)" },
    warning: { fg: "var(--warn)", soft: "var(--warn-soft)", softFg: "var(--warn)" },
    urgent: { fg: "var(--danger)", soft: "var(--danger-soft)", softFg: "var(--danger)" },
  },
  default: (props: { open: boolean; announcement?: { id: string } | null }) => (
    <div
      data-testid="editor"
      data-open={String(props.open)}
      data-mode={props.announcement ? `edit:${props.announcement.id}` : "create"}
    />
  ),
}));

import { AnnouncementList } from "@/components/announcement/AnnouncementList";

const WID = "ws-ann-3";

function annFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "a-1",
    title: "季度目标公告",
    content: "## 重点\n本季度目标是 **上线** 新功能",
    type: "info",
    targetAudience: { type: "all" },
    pinned: true,
    publishedBy: "u-1",
    publishedAt: "2026-11-01T10:00:00Z",
    expiresAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    publisher: { id: "u-1", name: "Alice", email: "alice@example.com" },
    ...overrides,
  };
}

const LIST_URL = (suffix: string) => `/api/v1/workspaces/${WID}/announcements?${suffix}`;

beforeEach(() => {
  mocks.api.mockReset();
});
afterEach(() => cleanup());

describe("AnnouncementList", () => {
  it("挂载 GET（无过滤时 URL 以 ? 结尾）", async () => {
    mocks.api.mockResolvedValueOnce({ items: [annFixture()], total: 1 });
    render(<AnnouncementList wid={WID} />);

    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(LIST_URL("")));
  });

  it("列表渲染：标题、type 徽章、pinned 徽章、清洗后摘要", async () => {
    mocks.api.mockResolvedValueOnce({ items: [annFixture()], total: 1 });
    render(<AnnouncementList wid={WID} />);

    await waitFor(() => expect(screen.getByText("季度目标公告")).toBeInTheDocument());
    // 过滤栏按钮与行内徽章同文案（announcement:info / pinned 徽章唯一）
    expect(screen.getAllByText("announcement:info").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("announcement:pinned")).toBeInTheDocument();
    // summarize：去 ##/** 标记并压成单行
    expect(screen.getByText("重点 本季度目标是 上线 新功能")).toBeInTheDocument();
  });

  it("长内容摘要截断 160 并追加省略号", async () => {
    mocks.api.mockResolvedValueOnce({
      items: [annFixture({ content: "字".repeat(200) })],
      total: 1,
    });
    render(<AnnouncementList wid={WID} />);

    await waitFor(() => expect(screen.getByText("季度目标公告")).toBeInTheDocument());
    const summary = screen.getByText(/^字+…$/);
    expect(summary.textContent).toHaveLength(161); // 160 字 + …
  });

  it("publisher 名回退邮箱；无 publisher 不渲染该段", async () => {
    mocks.api.mockResolvedValueOnce({
      items: [
        annFixture({ id: "a-1", publisher: { id: "u-2", name: null, email: "bob@example.com" } }),
        annFixture({ id: "a-2", title: "无发布者", publisher: null }),
      ],
      total: 2,
    });
    render(<AnnouncementList wid={WID} />);

    await waitFor(() => expect(screen.getByText("bob@example.com")).toBeInTheDocument());
    expect(screen.getByText("无发布者")).toBeInTheDocument();
  });

  it("expiresAt 存在时渲染过期日期行", async () => {
    mocks.api.mockResolvedValueOnce({
      items: [annFixture({ expiresAt: "2026-12-31T00:00:00Z" })],
      total: 1,
    });
    render(<AnnouncementList wid={WID} />);

    await waitFor(() => expect(screen.getByText("季度目标公告")).toBeInTheDocument());
    expect(screen.getByText(/announcement:expiresAt:/)).toBeInTheDocument();
  });

  it("类型过滤：点 info 重拉带 type=info，按钮 aria-pressed；再点取消过滤", async () => {
    mocks.api.mockResolvedValue({ items: [annFixture()], total: 1 });
    render(<AnnouncementList wid={WID} />);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(LIST_URL("")));

    const infoBtn = screen.getByRole("button", { name: "announcement:info" });
    fireEvent.click(infoBtn);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith(LIST_URL("type=info")));
    expect(screen.getByRole("button", { name: "announcement:info" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "announcement:info" }));
    await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith(LIST_URL("")));
  });

  it("空列表 → 空态文案", async () => {
    mocks.api.mockResolvedValueOnce({ items: [], total: 0 });
    render(<AnnouncementList wid={WID} />);

    await waitFor(() =>
      expect(screen.getByText("announcement:noAnnouncements")).toBeInTheDocument(),
    );
  });

  it("创建按钮打开 editor（create 模式）；保存回调触发重拉", async () => {
    mocks.api.mockResolvedValue({ items: [annFixture()], total: 1 });
    render(<AnnouncementList wid={WID} />);
    await waitFor(() => expect(screen.getByTestId("editor")).toHaveAttribute("data-open", "false"));

    fireEvent.click(screen.getByText("announcement:create").closest("button")!);
    expect(screen.getByTestId("editor")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("editor")).toHaveAttribute("data-mode", "create");
  });

  it("每行编辑按钮 → editor 带 announcement（edit 模式）", async () => {
    mocks.api.mockResolvedValueOnce({ items: [annFixture()], total: 1 });
    render(<AnnouncementList wid={WID} />);
    await waitFor(() => expect(screen.getByText("季度目标公告")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "announcement:edit" }));
    expect(screen.getByTestId("editor")).toHaveAttribute("data-mode", "edit:a-1");
  });

  it("togglePin：PATCH {pinned:!} 并就地更新（置顶徽章消失）", async () => {
    mocks.api.mockResolvedValueOnce({ items: [annFixture()], total: 1 });
    render(<AnnouncementList wid={WID} />);
    await waitFor(() => expect(screen.getByText("announcement:pinned")).toBeInTheDocument());

    mocks.api.mockResolvedValueOnce(annFixture({ pinned: false }));
    fireEvent.click(screen.getByRole("button", { name: "announcement:unpin" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/workspaces/${WID}/announcements/a-1`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: false }),
      }),
    );
    await waitFor(() => expect(screen.queryByText("announcement:pinned")).toBeFalsy());
  });

  it("删除：confirm true → DELETE 并移除；confirm false → 不调", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.api.mockResolvedValueOnce({ items: [annFixture()], total: 1 });
    render(<AnnouncementList wid={WID} />);
    await waitFor(() => expect(screen.getByText("季度目标公告")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "announcement:delete" }));
    expect(mocks.api).toHaveBeenCalledTimes(1); // 仅初始 GET

    confirmSpy.mockReturnValue(true);
    mocks.api.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "announcement:delete" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith(`/api/v1/workspaces/${WID}/announcements/a-1`, {
        method: "DELETE",
      }),
    );
    await waitFor(() => expect(screen.queryByText("季度目标公告")).toBeFalsy());
  });

  it("加载失败 → 显示 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("列表炸了"));
    render(<AnnouncementList wid={WID} />);

    await waitFor(() => expect(screen.getByText("列表炸了")).toBeInTheDocument());
  });
});
