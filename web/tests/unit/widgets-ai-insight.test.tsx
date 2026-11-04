// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status = 0,
      public code = 0,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { api: vi.fn(), ApiErrorClass: ApiError };
});
vi.mock("@/lib/api", () => ({ api: mocks.api, ApiError: mocks.ApiErrorClass }));

import AiInsightWidget from "@/components/widgets/AiInsightWidget";

const PATH = "/api/v1/workspaces/ws-1/ai/insights";

const insights = [
  {
    id: "i-1",
    title: "Release cadence up",
    summary: "Weekly releases since August",
    type: "opportunity",
    confidence: 0.9,
    createdAt: "2026-11-01T00:00:00Z",
  },
  {
    id: "i-2",
    title: "Two blocked tasks",
    summary: "Blocked for 5 days",
    type: "risk",
    confidence: 0.6,
    createdAt: "2026-11-01T00:00:00Z",
  },
  {
    id: "i-3",
    title: "Review latency falling",
    summary: "Down 20% week over week",
    type: "trend",
    confidence: 0.3,
    createdAt: "2026-11-01T00:00:00Z",
  },
  {
    id: "i-4",
    title: "Try daily standups",
    summary: "No standups recorded",
    type: "suggestion",
    createdAt: "2026-11-01T00:00:00Z",
  },
];

function defaultApi() {
  mocks.api.mockImplementation(async () => ({ items: insights }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AiInsightWidget", () => {
  it("加载中渲染骨架屏：aria-busy + 3 条占位", () => {
    defaultApi();
    const { container } = render(<AiInsightWidget wid="ws-1" />);
    expect(screen.getByLabelText("dashboard:aiInsightLoading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelectorAll("span.animate-pulse")).toHaveLength(6);
  });

  it("成功渲染：标题头、四条洞察与类型标签", async () => {
    defaultApi();
    render(<AiInsightWidget wid="ws-1" limit={4} />);
    await waitFor(() => expect(screen.getByText("Release cadence up")).toBeInTheDocument());

    expect(mocks.api).toHaveBeenCalledWith(PATH);
    expect(screen.getByRole("region", { name: "dashboard:aiInsight" })).toBeInTheDocument();
    // 头部标题文案（region 的 aria-label 同名但不是文本节点）
    expect(screen.getAllByText("dashboard:aiInsight")).toHaveLength(1);
    expect(screen.getByText("Weekly releases since August")).toBeInTheDocument();
    expect(screen.getByText("dashboard:insightTypeOpportunity")).toBeInTheDocument();
    expect(screen.getByText("dashboard:insightTypeRisk")).toBeInTheDocument();
    expect(screen.getByText("dashboard:insightTypeTrend")).toBeInTheDocument();
    expect(screen.getByText("dashboard:insightTypeSuggestion")).toBeInTheDocument();
  });

  it("置信度三档与缺省不渲染", async () => {
    defaultApi();
    render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Release cadence up")).toBeInTheDocument());

    expect(screen.getByText("dashboard:confidenceHigh")).toBeInTheDocument();
    expect(screen.getByText("dashboard:confidenceMedium")).toBeInTheDocument();
    expect(screen.getByText("dashboard:confidenceLow")).toBeInTheDocument();
    // 仅第 4 条无 confidence，且它没有置信度文案
    expect(screen.getAllByText(/^dashboard:confidence/)).toHaveLength(3);
  });

  it("未知洞察类型回退为建议标签", async () => {
    mocks.api.mockImplementation(async () => ({
      items: [{ ...insights[0], id: "i-x", type: "unknown-type" }],
    }));
    render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Release cadence up")).toBeInTheDocument());
    expect(screen.getByText("dashboard:insightTypeSuggestion")).toBeInTheDocument();
    expect(screen.queryByText("dashboard:insightTypeOpportunity")).not.toBeInTheDocument();
  });

  it("默认最多 3 条，limit 可覆盖", async () => {
    defaultApi();
    const { unmount } = render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Review latency falling")).toBeInTheDocument());
    expect(screen.queryByText("Try daily standups")).not.toBeInTheDocument();
    unmount();

    render(<AiInsightWidget wid="ws-1" limit={4} />);
    await waitFor(() => expect(screen.getByText("Try daily standups")).toBeInTheDocument());
  });

  it("404 视为未启用：显示占位而非错误", async () => {
    mocks.api.mockImplementation(async () => {
      throw new mocks.ApiErrorClass("not found", 404, 404);
    });
    render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() =>
      expect(screen.getByText("dashboard:aiInsightDisabled")).toBeInTheDocument(),
    );
    expect(screen.getByText("dashboard:aiInsightDisabledHint")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("dashboard:aiInsightLoadFailed")).not.toBeInTheDocument();
  });

  it("501 同样视为未启用", async () => {
    mocks.api.mockImplementation(async () => {
      throw new mocks.ApiErrorClass("not implemented", 501, 501);
    });
    render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() =>
      expect(screen.getByText("dashboard:aiInsightDisabled")).toBeInTheDocument(),
    );
  });

  it("ApiError 其他状态码与非 ApiError 都走错误态", async () => {
    mocks.api.mockImplementation(async () => {
      throw new mocks.ApiErrorClass("boom", 500, 500);
    });
    const first = render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() =>
      expect(screen.getByText("dashboard:aiInsightLoadFailed")).toBeInTheDocument(),
    );
    expect(screen.queryByText("dashboard:aiInsightDisabled")).not.toBeInTheDocument();
    first.unmount();

    mocks.api.mockImplementation(async () => {
      throw new Error("network down");
    });
    render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() =>
      expect(screen.getByText("dashboard:aiInsightLoadFailed")).toBeInTheDocument(),
    );
  });

  it("空数据渲染空态（含提示行）", async () => {
    mocks.api.mockImplementation(async () => ({ items: [] }));
    render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("dashboard:aiInsightEmpty")).toBeInTheDocument());
    expect(screen.getByText("dashboard:aiInsightEmptyHint")).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("切换工作区后按新 wid 重新拉取", async () => {
    defaultApi();
    const { rerender } = render(<AiInsightWidget wid="ws-1" />);
    await waitFor(() => expect(screen.getByText("Release cadence up")).toBeInTheDocument());

    rerender(<AiInsightWidget wid="ws-2" />);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/v1/workspaces/ws-2/ai/insights"),
    );
  });
});
