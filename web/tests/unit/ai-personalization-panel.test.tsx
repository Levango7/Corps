// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * PersonalizationPanel 契约（components/ai/PersonalizationPanel.tsx，named 导出）：
 *  1. 并行 GET recommendations?wid= 与 behaviors?wid=&limit=500（loading 态整面仅 generating）
 *  2. 行为聚合传给 BehaviorStats（capability 分桶、totalBehaviors）
 *  3. 推荐卡：typeLabel 映射（capability_recommendation→capability、未知→原文）、
 *     score.toFixed(2)、content 描述/建议/理由；未采纳时有采纳/拒绝按钮，已采纳只有徽标
 *  4. 采纳/拒绝乐观更新 + PATCH /api/v1/ai/personalization/recommendations/{id} {wid, applied}；
 *     PATCH 失败回滚 + t("error")
 *  5. 生成按钮 POST generate {wid, type: capability_recommendation} → 新推荐 prepend；空态 noRecommendations
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
vi.mock("@/components/ai/BehaviorStats", () => ({
  BehaviorStats: (props: { capabilities: unknown; totalBehaviors: number }) => (
    <div
      data-testid="bs"
      data-total={props.totalBehaviors}
      data-caps={JSON.stringify(props.capabilities)}
    />
  ),
}));

import { PersonalizationPanel } from "@/components/ai/PersonalizationPanel";

const WID = "ws-pp-1";

function recFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    type: "capability_recommendation",
    content: {
      description: "多用工单模板",
      suggestion: "为 IM 渠道启用自动摘要",
      reason: "近 7 天 IM 消息高频",
    },
    score: 0.85,
    applied: false,
    createdAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

function behaviorsFixture() {
  return [
    {
      id: "b-1",
      action: "use_capability",
      capability: "doc-qa",
      createdAt: "2026-11-01T00:00:00Z",
    },
    {
      id: "b-2",
      action: "accept_suggestion",
      capability: "doc-qa",
      createdAt: "2026-11-01T00:00:00Z",
    },
    {
      id: "b-3",
      action: "reject_suggestion",
      capability: "meeting",
      createdAt: "2026-11-01T00:00:00Z",
    },
  ];
}

/** 按 URL 分流的默认 api 实现（recommendations / behaviors 并行） */
function twoGetStub(recs: unknown[], behaviors: unknown[] = behaviorsFixture()) {
  mocks.api.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/ai/personalization/recommendations?")) {
      return Promise.resolve({ recommendations: recs });
    }
    return Promise.resolve({ behaviors });
  });
}

const acceptBtn = () =>
  screen.queryByRole("button", { name: "ai.aiPersonalization:acceptSuggestion" });
const rejectBtn = () =>
  screen.queryByRole("button", { name: "ai.aiPersonalization:rejectSuggestion" });

beforeEach(() => {
  mocks.api.mockReset();
});
afterEach(() => cleanup());

describe("PersonalizationPanel", () => {
  it("loading 态：整面只有 generating 文案", () => {
    mocks.api.mockReturnValue(new Promise(() => {}));
    render(<PersonalizationPanel wid={WID} />);

    expect(screen.getByText("ai.aiPersonalization:generating")).toBeInTheDocument();
    expect(screen.queryByTestId("bs")).toBeFalsy();
  });

  it("加载失败 → loadFailed 错误文案", async () => {
    mocks.api.mockRejectedValue(new Error("boom"));
    render(<PersonalizationPanel wid={WID} />);

    await waitFor(() =>
      expect(screen.getByText("ai.aiPersonalization:loadFailed")).toBeInTheDocument(),
    );
  });

  it("加载完成：标题/推荐计数/卡片内容（typeLabel、score 两位小数、描述/建议/理由）", async () => {
    twoGetStub([recFixture()]);
    render(<PersonalizationPanel wid={WID} />);

    await waitFor(() => expect(screen.getByText("多用工单模板")).toBeInTheDocument());
    expect(screen.getByText("ai.aiPersonalization:title")).toBeInTheDocument();
    expect(screen.getByText("ai.aiPersonalization:recommendations")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("ai.aiPersonalization:capability")).toBeInTheDocument();
    expect(screen.getByText(/0\.85/)).toBeInTheDocument();
    expect(screen.getByText("为 IM 渠道启用自动摘要")).toBeInTheDocument();
    expect(screen.getByText(/近 7 天 IM 消息高频/)).toBeInTheDocument();
  });

  it("未知推荐类型显示原文而非 i18n key", async () => {
    twoGetStub([recFixture({ id: "r-x", type: "custom_type" })]);
    render(<PersonalizationPanel wid={WID} />);

    await waitFor(() => expect(screen.getByText("多用工单模板")).toBeInTheDocument());
    expect(screen.getByText("custom_type")).toBeInTheDocument();
  });

  it("行为聚合传给 BehaviorStats：totalBehaviors=3，doc-qa 桶含 use/accept 计数", async () => {
    twoGetStub([recFixture()]);
    render(<PersonalizationPanel wid={WID} />);

    await waitFor(() => expect(screen.getByTestId("bs")).toBeInTheDocument());
    const bs = screen.getByTestId("bs");
    expect(bs.getAttribute("data-total")).toBe("3");
    const caps = JSON.parse(bs.getAttribute("data-caps") ?? "[]") as Array<Record<string, unknown>>;
    const docQa = caps.find((c) => c.capability === "doc-qa");
    expect(docQa).toBeTruthy();
    expect(docQa!.useCount).toBe(1);
    expect(docQa!.acceptCount).toBe(1);
  });

  it("未采纳卡片有采纳/拒绝按钮；已采纳卡片无按钮只有 applied 徽标", async () => {
    twoGetStub([recFixture({ id: "r-1" }), recFixture({ id: "r-2", applied: true })]);
    render(<PersonalizationPanel wid={WID} />);

    // 两张卡描述相同，取复数
    await waitFor(() => expect(screen.getAllByText("多用工单模板").length).toBeGreaterThan(0));
    expect(acceptBtn()).toBeTruthy();
    expect(rejectBtn()).toBeTruthy();
    // 仅 r-1 未采纳：accept 按钮只有一枚
    expect(
      screen.getAllByRole("button", { name: "ai.aiPersonalization:acceptSuggestion" }),
    ).toHaveLength(1);
  });

  it("空推荐列表 → noRecommendations 空态", async () => {
    twoGetStub([]);
    render(<PersonalizationPanel wid={WID} />);

    await waitFor(() =>
      expect(screen.getByLabelText("ai.aiPersonalization:noRecommendations")).toBeInTheDocument(),
    );
  });

  it("采纳：乐观置 applied + PATCH {wid, applied:true} → 徽标态；拒绝同理 applied:false", async () => {
    // 服务端状态可变：PATCH 成功后 loadData 重拉会返回 applied:true，验证徽标态稳定
    let serverApplied = false;
    mocks.api.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/ai/personalization/recommendations?")) {
        return Promise.resolve({ recommendations: [recFixture({ applied: serverApplied })] });
      }
      return Promise.resolve({ behaviors: [] });
    });
    render(<PersonalizationPanel wid={WID} />);
    await waitFor(() => expect(acceptBtn()).toBeTruthy());

    // 下一次调用（PATCH）翻转服务端状态
    mocks.api.mockImplementationOnce(() => {
      serverApplied = true;
      return Promise.resolve({});
    });
    fireEvent.click(acceptBtn()!);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/personalization/recommendations/r-1", {
        method: "PATCH",
        body: JSON.stringify({ wid: WID, applied: true }),
      }),
    );
    // 重拉返回 applied:true → 按钮消失、applied 徽标出现
    await waitFor(() => expect(acceptBtn()).toBeFalsy());
    expect(screen.getByText("ai.aiPersonalization:applied")).toBeInTheDocument();

    // 拒绝分支（重置回未采纳态）
    serverApplied = false;
    mocks.api.mockClear();
    render(<PersonalizationPanel wid={WID} />);
    await waitFor(() => expect(rejectBtn()).toBeTruthy());
    mocks.api.mockImplementationOnce(() => {
      serverApplied = true;
      return Promise.resolve({});
    });
    fireEvent.click(rejectBtn()!);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/personalization/recommendations/r-1", {
        method: "PATCH",
        body: JSON.stringify({ wid: WID, applied: false }),
      }),
    );
  });

  it("PATCH 失败 → 乐观回滚（按钮恢复）+ error 文案", async () => {
    twoGetStub([recFixture()]);
    render(<PersonalizationPanel wid={WID} />);
    await waitFor(() => expect(acceptBtn()).toBeTruthy());

    // 第 3 次调用起是 PATCH（前两次是并行 GET）
    mocks.api.mockImplementationOnce(() => Promise.reject(new Error("patch boom")));
    fireEvent.click(acceptBtn()!);

    await waitFor(() => expect(screen.getByText("ai.aiPersonalization:error")).toBeInTheDocument());
    expect(acceptBtn()).toBeTruthy();
  });

  it("生成：POST generate → 新推荐 prepend 到列表顶部", async () => {
    twoGetStub([recFixture()]);
    render(<PersonalizationPanel wid={WID} />);
    await waitFor(() => expect(screen.getByText("多用工单模板")).toBeInTheDocument());

    mocks.api.mockResolvedValueOnce({
      recommendations: [recFixture({ id: "r-new", content: { description: "新的推荐" } })],
    });
    fireEvent.click(screen.getByText("ai.aiPersonalization:generate").closest("button")!);

    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith("/api/v1/ai/personalization/generate", {
        method: "POST",
        body: JSON.stringify({ wid: WID, type: "capability_recommendation" }),
      }),
    );
    // 新推荐在最前（DOM 顺序先于旧推荐）
    const first = screen.getAllByText(/多用工单模板|新的推荐/)[0];
    expect(first.textContent).toContain("新的推荐");
  });

  it("生成失败 → error 文案", async () => {
    twoGetStub([recFixture()]);
    render(<PersonalizationPanel wid={WID} />);
    await waitFor(() => expect(screen.getByText("多用工单模板")).toBeInTheDocument());

    mocks.api.mockRejectedValueOnce(new Error("gen boom"));
    fireEvent.click(screen.getByText("ai.aiPersonalization:generate").closest("button")!);

    await waitFor(() => expect(screen.getByText("ai.aiPersonalization:error")).toBeInTheDocument());
  });
});
