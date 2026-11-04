// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

/**
 * UsageDashboard 契约（components/ai/UsageDashboard.tsx，named 导出，纯展示无按钮交互）：
 *  1. 挂载即 GET /api/v1/ai/usage/dashboard?workspaceId={wid}（带 AbortSignal）；
 *     loading 态整页只显示 t("dashboard")（非标题态）
 *  2. 失败 → t("loadFailed")，不泄露 e.message
 *  3. 成功：今日/本月卡片 —— calls 原样、tokens 分档（<1k 原样 / ≥1k N.Nk / ≥1M N.NM）、
 *     cost 分档（≥1 → $X.XX，<1 → $X.XXXX）
 *  4. topCapabilities / recentLogs 区块（空数组不渲染）；日志行含 success/failed 图标
 *     （aria-label=t("success"/"failed")）、相对时间（justNow/daysAgo…）、
 *     耗时格式化（<1s → Nms，≥1s → N.Ns）
 *  5. quota.ok=false → role="status" 警告区（标题 + reason）；quota 正常或缺失不渲染
 *  6. limit.dailyTokenLimit>0 → progressbar（aria-valuenow=min(100, tokens/limit*100)、
 *     aria-label=t("dailyTokenLimit")、内条 width 百分比）；无 limit 不渲染
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

import { UsageDashboard } from "@/components/ai/UsageDashboard";

const WID = "ws-usage-1";
const GET_URL = "/api/v1/ai/usage/dashboard?workspaceId=ws-usage-1";

interface LogShape {
  id: string;
  capability: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  durationMs: number;
  success: boolean;
  createdAt: string;
}

interface DashShape {
  today: { calls: number; tokens: number; cost: number };
  month: { calls: number; tokens: number; cost: number };
  topCapabilities: Array<{ capability: string; calls: number; tokens: number; cost: number }>;
  recentLogs: LogShape[];
  limit: {
    dailyTokenLimit: number | null;
    monthlyTokenLimit: number | null;
    dailyCallLimit: number | null;
    monthlyCallLimit: number | null;
  } | null;
  quota: { ok: boolean; reason?: string; usagePercent?: number } | null;
}

function makeLog(overrides: Partial<LogShape> = {}): LogShape {
  return {
    id: "log-1",
    capability: "task_breakdown",
    model: "glm-4",
    inputTokens: 10,
    outputTokens: 55,
    totalTokens: 65,
    cost: 0.01,
    durationMs: 250,
    success: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function baseDashboard(overrides: Partial<DashShape> = {}): DashShape {
  return {
    today: { calls: 12, tokens: 1500, cost: 2.5 },
    month: { calls: 320, tokens: 3_400_000, cost: 12.34 },
    topCapabilities: [],
    recentLogs: [],
    limit: null,
    quota: null,
    ...overrides,
  };
}

function tokenLimit(n: number): DashShape["limit"] {
  return {
    dailyTokenLimit: n,
    monthlyTokenLimit: null,
    dailyCallLimit: null,
    monthlyCallLimit: null,
  };
}

beforeEach(() => {
  mocks.api.mockReset();
});
afterEach(() => cleanup());

describe("UsageDashboard", () => {
  it("挂载即 GET /api/v1/ai/usage/dashboard?workspaceId=..（带 signal），loading 态非标题", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    render(<UsageDashboard wid={WID} />);

    expect(mocks.api).toHaveBeenCalledWith(GET_URL, { signal: expect.any(AbortSignal) });
    expect(screen.getByText("ai.usage:dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ai.usage:dashboard" })).toBeFalsy();
    resolveApi(baseDashboard());
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "ai.usage:dashboard" })).toBeInTheDocument(),
    );
  });

  it("加载失败 → t(loadFailed)，不泄露 e.message", async () => {
    mocks.api.mockRejectedValueOnce(new Error("sensitive boom"));
    render(<UsageDashboard wid={WID} />);
    expect(await screen.findByText("ai.usage:loadFailed")).toBeInTheDocument();
    expect(screen.queryByText("sensitive boom")).toBeFalsy();
  });

  it("今日/本月卡片：calls 原样、tokens 分档格式化、cost 两位/四位小数分档", async () => {
    mocks.api.mockResolvedValueOnce(baseDashboard());
    render(<UsageDashboard wid={WID} />);
    await screen.findByRole("heading", { name: "ai.usage:dashboard" });

    expect(screen.getByText("ai.usage:today")).toBeInTheDocument();
    expect(screen.getByText("ai.usage:thisMonth")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("1.5k")).toBeInTheDocument();
    expect(screen.getByText("$2.50")).toBeInTheDocument();
    expect(screen.getByText("320")).toBeInTheDocument();
    expect(screen.getByText("3.4M")).toBeInTheDocument();
    expect(screen.getByText("$12.34")).toBeInTheDocument();
  });

  it("Top 能力区块：能力名/调用次数/Token/成本（cost<1 走四位小数）", async () => {
    mocks.api.mockResolvedValueOnce(
      baseDashboard({
        topCapabilities: [{ capability: "task_breakdown", calls: 5, tokens: 800, cost: 0.5 }],
      }),
    );
    render(<UsageDashboard wid={WID} />);
    await screen.findByText("ai.usage:topCapabilities");

    expect(screen.getByText("task_breakdown")).toBeInTheDocument();
    expect(screen.getByText("5 ai.usage:calls")).toBeInTheDocument();
    expect(screen.getByText("800")).toBeInTheDocument();
    expect(screen.getByText("$0.5000")).toBeInTheDocument();
  });

  it("最近日志：成功/失败图标 aria-label、相对时间分档、耗时与 Token 格式化", async () => {
    mocks.api.mockResolvedValueOnce(
      baseDashboard({
        recentLogs: [
          makeLog(),
          makeLog({
            id: "log-2",
            capability: "daily_report",
            totalTokens: 100,
            durationMs: 1500,
            success: false,
            createdAt: new Date(Date.now() - 3 * 86_400_000 - 3_600_000).toISOString(),
          }),
        ],
      }),
    );
    render(<UsageDashboard wid={WID} />);
    await screen.findByText("ai.usage:recentLogs");

    expect(screen.getByLabelText("ai.usage:success")).toBeTruthy();
    expect(screen.getByLabelText("ai.usage:failed")).toBeTruthy();
    expect(screen.getByText("ai.usage:justNow")).toBeInTheDocument();
    expect(screen.getByText('ai.usage:daysAgo:{"n":3}')).toBeInTheDocument();
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.getByText("250ms")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("1.5s")).toBeInTheDocument();
  });

  it("quota 超限 → role=status 警告区（标题 + reason），且不阻断展示其余统计", async () => {
    mocks.api.mockResolvedValueOnce(
      baseDashboard({ quota: { ok: false, reason: "今日 Token 已超限" } }),
    );
    render(<UsageDashboard wid={WID} />);
    await screen.findByRole("status");

    expect(screen.getByText("ai.usage:quotaWarningTitle")).toBeInTheDocument();
    expect(screen.getByText("今日 Token 已超限")).toBeInTheDocument();
    expect(screen.getByText("ai.usage:today")).toBeInTheDocument();
  });

  it("quota 正常（ok=true）或缺失 → 不渲染警告区", async () => {
    mocks.api.mockResolvedValueOnce(baseDashboard({ quota: { ok: true } }));
    render(<UsageDashboard wid={WID} />);
    await screen.findByRole("heading", { name: "ai.usage:dashboard" });

    expect(screen.queryByRole("status")).toBeFalsy();
    expect(screen.queryByText("ai.usage:quotaWarningTitle")).toBeFalsy();
  });

  it("日 Token 限额进度条：aria-valuenow=75、label、内条 width=75%、用量文案 tokens/limit", async () => {
    mocks.api.mockResolvedValueOnce(baseDashboard({ limit: tokenLimit(2000) }));
    render(<UsageDashboard wid={WID} />);
    const bar = await screen.findByRole("progressbar");

    expect(bar.getAttribute("aria-valuenow")).toBe("75"); // 1500/2000*100，四舍五入
    expect(bar.getAttribute("aria-label")).toBe("ai.usage:dailyTokenLimit");
    expect(screen.getByText("ai.usage:dailyTokenLimit")).toBeInTheDocument();
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("75%");
    expect(screen.getByText("1.5k / 2.0k")).toBeInTheDocument();
  });

  it("无 limit（null）→ 不渲染进度条与限额文案", async () => {
    mocks.api.mockResolvedValueOnce(baseDashboard());
    render(<UsageDashboard wid={WID} />);
    await screen.findByRole("heading", { name: "ai.usage:dashboard" });

    expect(screen.queryByRole("progressbar")).toBeFalsy();
    expect(screen.queryByText("ai.usage:dailyTokenLimit")).toBeFalsy();
  });

  it("topCapabilities/recentLogs 为空 → 两个区块都不渲染", async () => {
    mocks.api.mockResolvedValueOnce(baseDashboard());
    render(<UsageDashboard wid={WID} />);
    await screen.findByRole("heading", { name: "ai.usage:dashboard" });

    expect(screen.queryByText("ai.usage:topCapabilities")).toBeFalsy();
    expect(screen.queryByText("ai.usage:recentLogs")).toBeFalsy();
  });
});
