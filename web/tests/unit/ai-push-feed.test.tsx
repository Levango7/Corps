// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

/**
 * AiPushFeed 契约（components/ai/AiPushFeed.tsx，named 导出）：
 *  1. 挂载即 GET /api/v1/ai/push/records?wid=..&limit=20；loading 态只有 Loader2 图标、无文案
 *  2. 成功渲染记录：标题/摘要/capability 显示名（未知名回退原文）/
 *     relativeTime（time 命名空间）/未读圆点/未读记录的标记已读按钮（title=t("markRead")）
 *  3. capability select（all/daily_briefing/risk_alert/progress_anomaly）变更 → 重新 GET 且 URL 带 capability
 *  4. 未读 checkbox（label 文案 t("unread")）勾选 → 重新 GET 且 URL 带 unread=true
 *  5. 标记已读：PATCH /api/v1/ai/push/records/{id} {wid,read:true}；进行中按钮 disabled；
 *     成功后本地置 read（不重拉列表）按钮与未读圆点消失；失败 t("error")
 *  6. hasMore 时出现"加载更多"按钮（文案 t("all")，与过滤 option 同名）→ GET 带 cursor 追加记录；失败 t("error")
 *  7. 首次加载失败 → t("loadFailed")；空列表 → Inbox + t("noRecords")；summary 为空不渲染摘要段
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

import { AiPushFeed } from "@/components/ai/AiPushFeed";

const WID = "ws-feed-1";

interface RecordShape {
  id: string;
  capability: string;
  title: string;
  summary: string;
  read: boolean;
  createdAt: string;
}

function makeRecord(overrides: Partial<RecordShape> = {}): RecordShape {
  return {
    id: "rec-1",
    capability: "daily_briefing",
    title: "晨间简报",
    summary: "今日有 3 项风险待处理",
    read: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function page(items: RecordShape[], opts: { nextCursor?: string | null; hasMore?: boolean } = {}) {
  return { items, nextCursor: opts.nextCursor ?? null, hasMore: opts.hasMore ?? false };
}

function markBtn() {
  return screen.getByTitle("aiPush:markRead") as HTMLButtonElement;
}

beforeEach(() => {
  mocks.api.mockReset();
});
afterEach(() => cleanup());

describe("AiPushFeed", () => {
  it("挂载即 GET /api/v1/ai/push/records?wid=..&limit=20，loading 期间只有图标无列表", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    const { container } = render(<AiPushFeed wid={WID} />);

    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/push/records?wid=ws-feed-1&limit=20");
    expect(container.querySelector("svg.lucide-loader-2")).toBeTruthy();
    expect(screen.queryByText("aiPush:noRecords")).toBeFalsy();
    resolveApi(page([]));
    await screen.findByText("aiPush:noRecords");
  });

  it("成功渲染：标题/摘要/capability 标签/相对时间；未读有点和标记按钮，已读没有", async () => {
    mocks.api.mockResolvedValueOnce(
      page([
        makeRecord(),
        makeRecord({
          id: "rec-2",
          capability: "risk_alert",
          title: "风险告警",
          summary: "接口 P99 超阈值",
          read: true,
          createdAt: new Date(Date.now() - 5 * 60_000 - 1_000).toISOString(),
        }),
      ]),
    );
    render(<AiPushFeed wid={WID} />);

    const li1 = (await screen.findByText("晨间简报")).closest("li")!;
    expect(within(li1).getByText("今日有 3 项风险待处理")).toBeInTheDocument();
    expect(within(li1).getByText("aiPush:dailyBriefing")).toBeInTheDocument();
    expect(within(li1).getByText("time:justNow")).toBeInTheDocument();
    expect(li1.querySelector(".rounded-full")).toBeTruthy(); // 未读圆点
    expect(within(li1).getByTitle("aiPush:markRead")).toBeTruthy();

    const li2 = screen.getByText("风险告警").closest("li")!;
    expect(within(li2).getByText("接口 P99 超阈值")).toBeInTheDocument();
    expect(within(li2).getByText("aiPush:riskAlert")).toBeInTheDocument();
    expect(within(li2).getByText('time:minutesAgo:{"count":5}')).toBeInTheDocument();
    expect(li2.querySelector(".rounded-full")).toBeFalsy();
    expect(within(li2).queryByTitle("aiPush:markRead")).toBeFalsy();
  });

  it("空列表 → Inbox 空态文案 noRecords", async () => {
    mocks.api.mockResolvedValueOnce(page([]));
    render(<AiPushFeed wid={WID} />);
    expect(await screen.findByText("aiPush:noRecords")).toBeInTheDocument();
  });

  it("首次加载失败 → t(loadFailed) 错误条，不泄露 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("sensitive boom"));
    render(<AiPushFeed wid={WID} />);
    expect(await screen.findByText("aiPush:loadFailed")).toBeInTheDocument();
    expect(screen.queryByText("sensitive boom")).toBeFalsy();
  });

  it("capability 过滤变更 → 重新 GET 且 URL 带 capability=risk_alert", async () => {
    mocks.api.mockResolvedValue(page([]));
    render(<AiPushFeed wid={WID} />);
    await screen.findByText("aiPush:noRecords");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "risk_alert" } });
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(
      2,
      "/api/v1/ai/push/records?wid=ws-feed-1&capability=risk_alert&limit=20",
    );
  });

  it("勾选未读过滤 → 重新 GET 且 URL 带 unread=true", async () => {
    mocks.api.mockResolvedValue(page([]));
    render(<AiPushFeed wid={WID} />);
    await screen.findByText("aiPush:noRecords");

    fireEvent.click(screen.getByLabelText("aiPush:unread"));
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(
      2,
      "/api/v1/ai/push/records?wid=ws-feed-1&unread=true&limit=20",
    );
  });

  it("标记已读：PATCH {wid,read:true}，成功后按钮/圆点消失且不重拉列表", async () => {
    mocks.api.mockResolvedValueOnce(page([makeRecord()])).mockResolvedValueOnce({});
    render(<AiPushFeed wid={WID} />);
    await screen.findByText("晨间简报");

    fireEvent.click(markBtn());
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenNthCalledWith(2, "/api/v1/ai/push/records/rec-1", {
      method: "PATCH",
      body: JSON.stringify({ wid: WID, read: true }),
    });
    await waitFor(() => expect(screen.queryByTitle("aiPush:markRead")).toBeFalsy());
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it("标记已读进行中：按钮 disabled，完成前可阻塞重复提交", async () => {
    let resolvePatch!: (v: unknown) => void;
    mocks.api.mockResolvedValueOnce(page([makeRecord()]));
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolvePatch = res;
      }),
    );
    render(<AiPushFeed wid={WID} />);
    await screen.findByText("晨间简报");

    fireEvent.click(markBtn());
    await waitFor(() => expect(markBtn()).toBeDisabled());
    fireEvent.click(markBtn()); // disabled 下不触发第二次 PATCH
    resolvePatch({});
    await waitFor(() => expect(screen.queryByTitle("aiPush:markRead")).toBeFalsy());
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it("标记已读失败 → t(error) 错误条", async () => {
    mocks.api.mockResolvedValueOnce(page([makeRecord()])).mockRejectedValueOnce(new Error("boom"));
    render(<AiPushFeed wid={WID} />);
    await screen.findByText("晨间简报");

    fireEvent.click(markBtn());
    expect(await screen.findByText("aiPush:error")).toBeInTheDocument();
  });

  it("加载更多：GET 带 cursor 并追加记录；无更多后按钮消失", async () => {
    mocks.api
      .mockResolvedValueOnce(page([makeRecord()], { nextCursor: "cur-9", hasMore: true }))
      .mockResolvedValueOnce(page([makeRecord({ id: "rec-2", title: "下午提醒" })]));
    render(<AiPushFeed wid={WID} />);
    await screen.findByText("晨间简报");

    fireEvent.click(screen.getByRole("button", { name: "aiPush:all" }));
    await screen.findByText("下午提醒");
    expect(mocks.api).toHaveBeenNthCalledWith(
      2,
      "/api/v1/ai/push/records?wid=ws-feed-1&cursor=cur-9&limit=20",
    );
    expect(screen.queryByRole("button", { name: "aiPush:all" })).toBeFalsy();
  });

  it("加载更多失败 → t(error)，已有记录保留", async () => {
    mocks.api
      .mockResolvedValueOnce(page([makeRecord()], { nextCursor: "cur-9", hasMore: true }))
      .mockRejectedValueOnce(new Error("boom"));
    render(<AiPushFeed wid={WID} />);
    await screen.findByText("晨间简报");

    fireEvent.click(screen.getByRole("button", { name: "aiPush:all" }));
    expect(await screen.findByText("aiPush:error")).toBeInTheDocument();
    expect(screen.getByText("晨间简报")).toBeInTheDocument();
  });

  it("未知 capability 显示名回退原文；summary 为空不渲染摘要段", async () => {
    mocks.api.mockResolvedValueOnce(
      page([makeRecord({ capability: "weekly_digest", summary: "" })]),
    );
    render(<AiPushFeed wid={WID} />);
    const li = (await screen.findByText("晨间简报")).closest("li")!;
    expect(within(li).getByText("weekly_digest")).toBeInTheDocument();
    expect(li.querySelectorAll("p")).toHaveLength(0);
  });
});
