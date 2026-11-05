// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  apiList: vi.fn(),
  push: vi.fn(),
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
vi.mock("@/lib/api", () => ({ api: mocks.api, apiList: mocks.apiList }));
// 组件用 lib/i18n-navigation 的 useRouter（next-intl createNavigation 包装 next/navigation）
vi.mock("@/lib/i18n-navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { MeetingList } from "@/components/meeting/MeetingList";

beforeEach(() => {
  mocks.api.mockReset();
  mocks.apiList.mockReset();
  mocks.push.mockReset();
});
afterEach(() => cleanup());

/** 完整形状的会议项：缺字段会让渲染落到 undefined 分支 */
function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "每周同步",
    status: "active",
    startedAt: "2030-05-06T10:00:00.000Z",
    endedAt: null,
    scheduledAt: null,
    _count: { participants: 3 },
    maxParticipants: 20,
    createdBy: "u1",
    recordingUrl: null,
    description: null,
    type: "instant",
    recordingEnabled: false,
    creator: null,
    ...over,
  };
}

/** 列表接口默认桩：page 信封 + 空用户上下文 */
function stubList(over: { items?: unknown[]; total?: number; page?: number } = {}) {
  const payload = {
    items: over.items ?? [],
    total: over.total ?? (over.items ?? []).length,
    page: over.page ?? 1,
    limit: 20,
    hasMore: false,
  };
  mocks.api.mockImplementation((path: string) => {
    if (path === "/api/v1/users/me")
      return Promise.resolve({ id: "u1", name: "我", email: "a@b.c" });
    if (path.includes("/members?limit=100")) {
      return Promise.resolve({ items: [{ id: "u1", role: "member", isSelf: true }] });
    }
    if (path.includes("/meetings?")) return Promise.resolve(payload);
    return Promise.resolve({});
  });
  return payload;
}

/** 等列表首帧渲染完成（loading 文案消失） */
async function ready() {
  await waitFor(() => expect(screen.queryByText("meeting:loading")).toBeNull());
}

describe("MeetingList", () => {
  it("挂载请求 URL/参数精确：列表分页 + /users/me + 成员角色", async () => {
    stubList({ items: [meeting()] });
    render(<MeetingList workspaceId="w42" />);
    await ready();

    const paths = mocks.api.mock.calls.map((c) => c[0] as string);
    expect(paths).toContain("/api/v1/workspaces/w42/meetings?page=1&limit=20");
    expect(paths).toContain("/api/v1/users/me");
    expect(paths).toContain("/api/v1/workspaces/w42/members?limit=100");
    // 列表请求是裸 GET：不带 method/body
    const listCall = mocks.api.mock.calls.find((c) => String(c[0]).includes("/meetings?"))!;
    expect(listCall[1]).toBeUndefined();
  });

  it("首帧 loading 态：接口挂起时只显示 loading 文案", async () => {
    let release: (v: unknown) => void = () => {};
    mocks.api.mockImplementation((path: string) => {
      if (path.includes("/meetings?")) {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve({ id: "u1", items: [] });
    });

    render(<MeetingList workspaceId="w1" />);
    expect(screen.getByText("meeting:loading")).toBeInTheDocument();
    expect(screen.queryByText("meeting:noMeetings")).toBeNull();

    release({ items: [], total: 0, page: 1, limit: 20, hasMore: false });
    await waitFor(() => expect(screen.getByText("meeting:noMeetings")).toBeInTheDocument());
  });

  it("空列表：显示空态，不渲染任何分组", async () => {
    stubList({ items: [] });
    const { container } = render(<MeetingList workspaceId="w1" />);
    await ready();

    expect(screen.getByText("meeting:noMeetings")).toBeInTheDocument();
    expect(container.querySelectorAll("section").length).toBe(0);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("按状态分组：只渲染存在的分组，标题带条目数", async () => {
    stubList({
      items: [
        meeting({ id: "a1", title: "进行中会议", status: "active" }),
        meeting({ id: "s1", title: "待开始会议", status: "scheduled" }),
        meeting({ id: "e1", title: "已结束会议", status: "ended" }),
        meeting({ id: "s2", title: "待开始会议2", status: "scheduled" }),
      ],
    });
    const { container } = render(<MeetingList workspaceId="w1" />);
    await ready();

    const headings = Array.from(container.querySelectorAll("section > h2")).map(
      (h) => h.textContent,
    );
    expect(headings).toEqual([
      "meeting:activeMeetings · 1",
      "meeting:scheduledMeetings · 2",
      "meeting:endedMeetings · 1",
    ]);
  });

  it("加入会议：push 到会议详情路由（含 workspaceId + meetingId）", async () => {
    stubList({ items: [meeting({ id: "mx", status: "scheduled" })] });
    render(<MeetingList workspaceId="w9" />);
    await ready();

    // 每行两个"加入"按钮（移动端图标 + 桌面文案）共用 meeting:join，取第一个可点
    fireEvent.click(screen.getAllByRole("button", { name: "meeting:join" })[0]);
    expect(mocks.push).toHaveBeenCalledWith("/w/w9/meetings/mx");
  });

  it("结束会议：DELETE 精确 URL，成功后本地置为 ended 并清掉结束按钮", async () => {
    stubList({ items: [meeting({ id: "m1", status: "active" })] });
    render(<MeetingList workspaceId="w1" />);
    await ready();

    expect(screen.getByRole("button", { name: "meeting:end" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "meeting:end" }));

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(4));
    const del = mocks.api.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method);
    expect(del?.[0]).toBe("/api/v1/workspaces/w1/meetings/m1");
    expect((del?.[1] as RequestInit).method).toBe("DELETE");

    // 状态更新为 ended：结束按钮消失，加入按钮也消失（ended 无主要操作）
    await waitFor(() => expect(screen.queryByRole("button", { name: "meeting:end" })).toBeNull());
    expect(screen.queryByRole("button", { name: "meeting:join" })).toBeNull();
  });

  it("结束会议失败：显示 e.message，行仍保留 active 操作", async () => {
    mocks.api.mockImplementation((path: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") return Promise.reject(new Error("仅主持人可结束会议"));
      if (path === "/api/v1/users/me") return Promise.resolve({ id: "u1" });
      if (path.includes("/members?limit=100")) return Promise.resolve({ items: [] });
      return Promise.resolve({
        items: [meeting({ id: "m1" })],
        total: 1,
        page: 1,
        limit: 20,
        hasMore: false,
      });
    });
    render(<MeetingList workspaceId="w1" />);
    await ready();

    fireEvent.click(screen.getByRole("button", { name: "meeting:end" }));
    expect(await screen.findByText("仅主持人可结束会议")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "meeting:end" })).toBeEnabled();
  });

  it("列表加载失败：显示 e.message，关闭按钮可清空错误", async () => {
    mocks.api.mockImplementation((path: string) => {
      if (path.includes("/meetings?")) return Promise.reject(new Error("工作区不存在"));
      return Promise.resolve({ id: "u1", items: [] });
    });
    render(<MeetingList workspaceId="w1" />);
    await waitFor(() => expect(screen.getByText("工作区不存在")).toBeInTheDocument());
    // 列表失败后退出 loading，落到空态
    expect(screen.getByText("meeting:noMeetings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "meeting:dismiss" }));
    expect(screen.queryByText("工作区不存在")).toBeNull();
  });

  it("分页：total 超过一页时显示分页条，上一页禁用，翻页重发 page=2", async () => {
    stubList({ items: [meeting({ id: "m1" })], total: 45 });
    render(<MeetingList workspaceId="w1" />);
    await ready();

    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "meeting:prevPage" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "meeting:nextPage" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "meeting:nextPage" }));

    await waitFor(() =>
      expect(mocks.api.mock.calls.some((c) => String(c[0]).endsWith("page=2&limit=20"))).toBe(true),
    );
    await waitFor(() => expect(screen.getByText("2 / 3")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "meeting:prevPage" })).toBeEnabled();
  });

  it("单页（total ≤ 20）不渲染分页条", async () => {
    stubList({ items: [meeting()], total: 20 });
    render(<MeetingList workspaceId="w1" />);
    await ready();

    expect(screen.queryByRole("button", { name: "meeting:nextPage" })).toBeNull();
    expect(screen.queryByText("1 / 1")).toBeNull();
  });

  it("创建者或 admin 才能编辑：创建者看得到编辑入口，非创建者且 member 看不到", async () => {
    stubList({
      items: [
        meeting({ id: "mine", status: "scheduled", createdBy: "u1", title: "我创建的预约" }),
        meeting({ id: "other", status: "scheduled", createdBy: "u2", title: "别人的预约" }),
      ],
    });
    render(<MeetingList workspaceId="w1" />);
    await ready();

    // 仅"我创建的"那一行有编辑按钮（md 以上文案按钮）
    const editButtons = screen.getAllByRole("button", { name: "button:edit" });
    expect(editButtons.length).toBe(1);

    // 点击后打开编辑弹窗（MeetingCreate 编辑模式，标题走 button:edit + 表单标题回填）
    fireEvent.click(editButtons[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    const titleInput = dialog.querySelector<HTMLInputElement>("#mc-title");
    expect(titleInput?.value).toBe("我创建的预约");
  });

  it("admin 角色可编辑他人会议；录制回放链接只对已结束且有非 egress URL 的会议显示", async () => {
    mocks.api.mockImplementation((path: string) => {
      if (path === "/api/v1/users/me") return Promise.resolve({ id: "u1" });
      if (path.includes("/members?limit=100")) {
        return Promise.resolve({ items: [{ id: "u1", role: "admin", isSelf: true }] });
      }
      return Promise.resolve({
        items: [
          meeting({ id: "other", status: "scheduled", createdBy: "u2", title: "别人的预约" }),
          meeting({
            id: "rec",
            status: "ended",
            title: "有回放",
            recordingUrl: "https://cdn.example.com/rec.mp4",
          }),
          meeting({
            id: "pending",
            status: "ended",
            title: "录制中",
            recordingUrl: "egress:abc",
          }),
        ],
        total: 3,
        page: 1,
        limit: 20,
        hasMore: false,
      });
    });
    render(<MeetingList workspaceId="w1" />);
    await ready();

    // admin → 他人预约也出现编辑按钮（member 角色下此处为 0，见上一条用例）
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "button:edit" }).length).toBe(1),
    );
    // 编辑的是他人的那条会议，确认角色判定（而非创建者判定）生效
    fireEvent.click(screen.getAllByRole("button", { name: "button:edit" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector<HTMLInputElement>("#mc-title")?.value).toBe("别人的预约");

    // 回放链接只出现一次（egress: 前缀的 pending 录制被过滤）
    const playLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="rec.mp4"]'),
    );
    expect(playLinks.length).toBe(1);
    expect(playLinks[0].getAttribute("target")).toBe("_blank");
    expect(document.querySelectorAll('a[href^="egress:"]').length).toBe(0);
  });
});
