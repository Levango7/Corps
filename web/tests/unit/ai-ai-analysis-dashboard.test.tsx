// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

/**
 * AiAnalysisDashboard 契约（components/ai/AiAnalysisDashboard.tsx，default 导出）：
 *  1. 4 个分析 tab（burndown/team_performance/bottleneck/weekly_report，aria-current=page），
 *     切 tab 不自动请求；初始空态 noReports、无反馈按钮
 *  2. 周期 select（aria-label=period，thisWeek/lastWeek/thisMonth/custom，默认 thisWeek）
 *  3. 点"开始分析"按 activeType POST：
 *     burndown/team-performance → {wid, period:{start,end}}（预设周期按周一起算）；
 *     bottleneck → {wid}；weekly-report → {wid, weekStart=period.start}（custom 时无 weekStart）
 *  4. burndown 渲染 BurndownChart(idealLine/actualLine/predictedCompletion) + summary/
 *     predictedCompletion/deviation/insights；team_performance 渲染成员表
 *     (completionRate%、avgCycleDays、strengths join)；bottleneck 渲染 criticalPath 链 +
 *     bottlenecks 列表；weekly_report 渲染 completed/planned/risks/milestones 四区（空列表占位 -）
 *  5. 失败 → t("error") + 重试按钮（再次 POST 成功恢复）；历史报告按钮 →
 *     GET /api/v1/ai/analysis/reports?wid=&type=<activeType>&page=1&pageSize=20，
 *     抽屉渲染条目/空态；FeedbackButtons(capability=analysis-<activeType>)
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
vi.mock("@/components/ai/BurndownChart", () => ({
  BurndownChart: (props: {
    idealLine: unknown[];
    actualLine: unknown[];
    predictedCompletion?: string;
  }) => (
    <div
      data-testid="chart"
      data-ideal={props.idealLine.length}
      data-actual={props.actualLine.length}
      data-pred={props.predictedCompletion ?? ""}
    />
  ),
}));
vi.mock("@/components/ai/FeedbackButtons", () => ({
  FeedbackButtons: (props: { capability?: string; workspaceId?: string }) => (
    <div
      data-testid="fb"
      data-capability={props.capability ?? ""}
      data-wid={props.workspaceId ?? ""}
    />
  ),
}));

import AiAnalysisDashboard from "@/components/ai/AiAnalysisDashboard";

const WID = "ws-aad-1";
const NS = "ai.aiAnalysis";

const BURNDOWN = {
  reportId: "rep-bd-1",
  summary: "本周燃尽进度正常",
  idealLine: [{ date: "2026-11-02", remaining: 10 }],
  actualLine: [{ date: "2026-11-03", remaining: 9 }],
  predictedCompletion: "2026-11-08",
  deviation: "领先 1 天",
  insights: ["接近理想线"],
};
const TEAM = {
  reportId: "rep-tp-1",
  summary: "团队效能稳定",
  members: [
    {
      name: "Alice",
      completionRate: 0.85,
      avgCycleDays: 3.5,
      workload: 4,
      strengths: ["沟通", "前端"],
    },
    { name: "Bob", completionRate: 0.7, avgCycleDays: 2, workload: 2, strengths: ["后端"] },
  ],
  insights: ["Alice 交付最快"],
};
const BNE = {
  reportId: "rep-bn-1",
  summary: "存在一处瓶颈",
  bottlenecks: [
    {
      taskTitle: "接口联调",
      reason: "依赖第三方沙箱",
      impact: "阻塞联调两天",
      suggestion: "提前申请沙箱账号",
    },
  ],
  criticalPath: ["需求评审", "后端开发", "上线验收"],
  insights: [],
};
const WEEKLY = {
  reportId: "rep-wk-1",
  summary: "本周完成 1 项",
  completed: [],
  planned: [{ title: "灰度发布", owner: "Bob", dueDate: "2026-11-10" }],
  risks: [{ description: "第三方接口不稳定", level: "high" }],
  milestones: [{ title: "v2 上线", status: "进行中" }],
  insights: [],
};
const HISTORY = {
  items: [
    {
      id: "rep-1",
      type: "burndown",
      title: "燃尽周报 11-02",
      summary: "燃尽正常",
      createdAt: "2026-11-03T10:00:00.000Z",
    },
  ],
  total: 1,
};

/** 复刻组件 presetPeriod 的预设周期（与组件同毫秒级时刻计算，断言精确相等） */
function expectedPeriod(preset: "thisWeek" | "lastWeek"): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((day + 6) % 7) - (preset === "lastWeek" ? 7 : 0));
  const start = new Date(monday);
  start.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const end = new Date(sunday);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function renderDashboard() {
  return render(<AiAnalysisDashboard wid={WID} />);
}
function tab(key: string) {
  return screen.getByRole("button", { name: `${NS}:${key}` });
}
function runButton() {
  return screen.getByText(`${NS}:run`).closest("button") as HTMLButtonElement;
}
function periodSelect() {
  return screen.getByLabelText(`${NS}:period`) as HTMLSelectElement;
}

beforeEach(() => {
  mocks.api.mockReset();
});
afterEach(() => cleanup());

describe("AiAnalysisDashboard", () => {
  it("初始骨架：标题、4 个 tab（burndown 激活）、周期 select 默认 thisWeek、空态 noReports、无请求", () => {
    renderDashboard();
    expect(screen.getByText(`${NS}:title`)).toBeInTheDocument();
    for (const key of ["burndown", "teamPerformance", "bottleneck", "weeklyReport"]) {
      expect(tab(key)).toBeInTheDocument();
    }
    expect(tab("burndown")).toHaveAttribute("aria-current", "page");
    expect(tab("teamPerformance")).not.toHaveAttribute("aria-current");
    expect(periodSelect()).toHaveValue("thisWeek");
    expect(runButton()).toBeEnabled();
    expect(screen.getByText(`${NS}:noReports`)).toBeInTheDocument();
    expect(screen.queryByTestId("fb")).toBeFalsy();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("燃尽分析：POST /api/v1/ai/analysis/burndown body {wid, period:thisWeek 周一至周日}；analyzing 态按钮 disabled", async () => {
    let resolveApi!: (v: unknown) => void;
    mocks.api.mockReturnValueOnce(
      new Promise((res) => {
        resolveApi = res;
      }),
    );
    renderDashboard();
    const exp = expectedPeriod("thisWeek");
    fireEvent.click(runButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/analysis/burndown", {
      method: "POST",
      body: JSON.stringify({ wid: WID, period: exp }),
      signal: expect.any(AbortSignal),
    });
    const analyzingBtn = screen
      .getAllByText(`${NS}:analyzing`)
      .map((el) => el.closest("button"))
      .find((b): b is HTMLButtonElement => b !== null);
    expect(analyzingBtn).toBeDisabled();

    resolveApi(BURNDOWN);
    await waitFor(() => expect(screen.getByText(BURNDOWN.summary)).toBeInTheDocument());
  });

  it("燃尽结果渲染：summary、BurndownChart props、predictedCompletion/deviation/insights + FeedbackButtons(analysis-burndown)", async () => {
    mocks.api.mockResolvedValueOnce(BURNDOWN);
    renderDashboard();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(BURNDOWN.summary)).toBeInTheDocument());

    expect(screen.getByText(`${NS}:summary`)).toBeInTheDocument();
    const chart = screen.getByTestId("chart");
    expect(chart.getAttribute("data-ideal")).toBe("1");
    expect(chart.getAttribute("data-actual")).toBe("1");
    expect(chart.getAttribute("data-pred")).toBe("2026-11-08");
    expect(screen.getByText(`${NS}:predictedCompletion`)).toBeInTheDocument();
    expect(screen.getByText("2026-11-08")).toBeInTheDocument();
    expect(screen.getByText("领先 1 天")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:insights`)).toBeInTheDocument();
    expect(screen.getByText("接近理想线")).toBeInTheDocument();
    // 有结果后空态消失
    expect(screen.queryByText(`${NS}:noReports`)).toBeFalsy();
    const fb = screen.getByTestId("fb");
    expect(fb.getAttribute("data-capability")).toBe("analysis-burndown");
    expect(fb.getAttribute("data-wid")).toBe(WID);
  });

  it("团队效能：切 tab 后 POST /api/v1/ai/analysis/team-performance {wid, period}；表格渲染 %与天数与优势 join + FB", async () => {
    mocks.api.mockResolvedValueOnce(TEAM);
    renderDashboard();
    fireEvent.click(tab("teamPerformance"));
    expect(tab("teamPerformance")).toHaveAttribute("aria-current", "page");
    const exp = expectedPeriod("thisWeek");
    fireEvent.click(runButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/analysis/team-performance", {
      method: "POST",
      body: JSON.stringify({ wid: WID, period: exp }),
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("团队效能稳定")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("3.5")).toBeInTheDocument();
    expect(screen.getByText("沟通、前端")).toBeInTheDocument();
    expect(screen.getByText("Alice 交付最快")).toBeInTheDocument();
    expect(screen.getByTestId("fb").getAttribute("data-capability")).toBe(
      "analysis-team_performance",
    );
  });

  it("瓶颈分析：POST body 恰为 {wid}；criticalPath 链与 bottlenecks 列表渲染 + FB", async () => {
    mocks.api.mockResolvedValueOnce(BNE);
    renderDashboard();
    fireEvent.click(tab("bottleneck"));
    fireEvent.click(runButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/analysis/bottleneck", {
      method: "POST",
      body: JSON.stringify({ wid: WID }),
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(screen.getByText(BNE.summary)).toBeInTheDocument());
    for (const task of BNE.criticalPath) {
      expect(screen.getByText(task)).toBeInTheDocument();
    }
    expect(screen.getByText("接口联调")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:bottlenecks：依赖第三方沙箱`)).toBeInTheDocument();
    expect(screen.getByText("阻塞联调两天")).toBeInTheDocument();
    expect(screen.getByText("提前申请沙箱账号")).toBeInTheDocument();
    expect(screen.getByTestId("fb").getAttribute("data-capability")).toBe("analysis-bottleneck");
  });

  it("周报（thisWeek）：POST body {wid, weekStart=thisWeek 周一}；四区渲染（completed 空列表占位 -）+ FB", async () => {
    mocks.api.mockResolvedValueOnce(WEEKLY);
    renderDashboard();
    fireEvent.click(tab("weeklyReport"));
    const exp = expectedPeriod("thisWeek");
    fireEvent.click(runButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/analysis/weekly-report", {
      method: "POST",
      body: JSON.stringify({ wid: WID, weekStart: exp.start }),
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(screen.getByText(WEEKLY.summary)).toBeInTheDocument());
    expect(screen.getByText(`${NS}:completed`)).toBeInTheDocument();
    expect(screen.getByText("-", { exact: true })).toBeInTheDocument(); // completed 空
    expect(screen.getByText(`${NS}:planned`)).toBeInTheDocument();
    expect(screen.getByText("灰度发布")).toBeInTheDocument();
    expect(screen.getByText(`${NS}:risks`)).toBeInTheDocument();
    expect(screen.getByText("第三方接口不稳定")).toBeInTheDocument();
    expect(screen.getByLabelText("high")).toBeInTheDocument(); // 风险等级色点
    expect(screen.getByText(`${NS}:milestones`)).toBeInTheDocument();
    expect(screen.getByText("v2 上线")).toBeInTheDocument();
    expect(screen.getByTestId("fb").getAttribute("data-capability")).toBe("analysis-weekly_report");
  });

  it("周报（custom 周期）：POST body 恰为 {wid}（无 weekStart）", async () => {
    mocks.api.mockResolvedValueOnce(WEEKLY);
    renderDashboard();
    fireEvent.click(tab("weeklyReport"));
    fireEvent.change(periodSelect(), { target: { value: "custom" } });
    expect(periodSelect()).toHaveValue("custom");
    fireEvent.click(runButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/analysis/weekly-report", {
      method: "POST",
      body: JSON.stringify({ wid: WID }),
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(screen.getByText(WEEKLY.summary)).toBeInTheDocument());
  });

  it("分析失败 → t('error') 错误条 + 重试按钮（第二个 run）点击再次 POST 成功恢复", async () => {
    mocks.api.mockRejectedValueOnce(new Error("boom"));
    renderDashboard();
    fireEvent.click(runButton());

    await waitFor(() => expect(screen.getByText(`${NS}:error`)).toBeInTheDocument());
    const runTexts = screen.getAllByText(`${NS}:run`);
    expect(runTexts.length).toBe(2); // 控制栏按钮 + 重试按钮

    mocks.api.mockResolvedValueOnce(BURNDOWN);
    fireEvent.click(runTexts[1].closest("button")!);
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
    expect(mocks.api).toHaveBeenLastCalledWith(
      "/api/v1/ai/analysis/burndown",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(screen.queryByText(`${NS}:error`)).toBeFalsy());
    expect(screen.getByText(BURNDOWN.summary)).toBeInTheDocument();
  });

  it("历史报告：GET URL 精确（type=burndown）+ 抽屉渲染条目；切 tab 后重开 URL type 随 tab", async () => {
    mocks.api.mockResolvedValueOnce(BURNDOWN).mockResolvedValue(HISTORY);
    renderDashboard();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(BURNDOWN.summary)).toBeInTheDocument());

    fireEvent.click(screen.getByText(`${NS}:history`).closest("button")!);
    await waitFor(() => expect(screen.getByText("燃尽周报 11-02")).toBeInTheDocument());
    expect(mocks.api).toHaveBeenLastCalledWith(
      `/api/v1/ai/analysis/reports?wid=${WID}&type=burndown&page=1&pageSize=20`,
      { method: "GET" },
    );
    expect(screen.getByText("燃尽正常")).toBeInTheDocument();

    // 关闭抽屉 → 切 tab → 重开，URL 的 type 跟随 activeType
    fireEvent.click(screen.getByLabelText("close"));
    expect(screen.queryByText("燃尽周报 11-02")).toBeFalsy();
    fireEvent.click(tab("teamPerformance"));
    fireEvent.click(screen.getByText(`${NS}:history`).closest("button")!);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith(
        `/api/v1/ai/analysis/reports?wid=${WID}&type=team_performance&page=1&pageSize=20`,
        { method: "GET" },
      ),
    );
  });

  it("历史为空 → 抽屉内 noReports（主区有结果时空态仅一处）", async () => {
    mocks.api.mockResolvedValueOnce(BURNDOWN).mockResolvedValueOnce({ items: [], total: 0 });
    renderDashboard();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText(BURNDOWN.summary)).toBeInTheDocument());

    fireEvent.click(screen.getByText(`${NS}:history`).closest("button")!);
    await waitFor(() =>
      expect(mocks.api).toHaveBeenLastCalledWith(
        `/api/v1/ai/analysis/reports?wid=${WID}&type=burndown&page=1&pageSize=20`,
        { method: "GET" },
      ),
    );
    expect(screen.getAllByText(`${NS}:noReports`).length).toBe(1);
  });

  it("周期切换 lastWeek：burndown body period 精确为上周一至周日", async () => {
    mocks.api.mockResolvedValueOnce(BURNDOWN);
    renderDashboard();
    fireEvent.change(periodSelect(), { target: { value: "lastWeek" } });
    const exp = expectedPeriod("lastWeek");
    fireEvent.click(runButton());

    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledWith("/api/v1/ai/analysis/burndown", {
      method: "POST",
      body: JSON.stringify({ wid: WID, period: exp }),
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(screen.getByText(BURNDOWN.summary)).toBeInTheDocument());
  });

  it("切 tab 不自动发起请求，aria-current 随 tab 转移", () => {
    renderDashboard();
    expect(mocks.api).not.toHaveBeenCalled();

    fireEvent.click(tab("bottleneck"));
    expect(mocks.api).not.toHaveBeenCalled();
    expect(tab("bottleneck")).toHaveAttribute("aria-current", "page");
    expect(tab("burndown")).not.toHaveAttribute("aria-current");
    // 无结果时切 tab 仍显示空态
    expect(screen.getByText(`${NS}:noReports`)).toBeInTheDocument();
  });
});
