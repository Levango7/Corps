// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * 行为统计图表契约（components/ai/BehaviorStats.tsx）：
 *  1. 空数据态：role=img + t("stats")、BarChart3 图标、t("noRecommendations")
 *  2. 柱状图最多 8 个能力（slice(0,8)），第 9/10 个不进柱子也不进比率行
 *  3. 柱高按 total/maxCount 等比：max 柱满高（plotHeight=160），
 *     半值柱恰好一半高（80）
 *  4. 柱子 <title> 为 "capability: total"，柱顶数值标签，X 轴标签截断
 *     （超过 12 字符 + "…"）
 *  5. Y 轴 4 等分 5 个刻度：0…maxCount
 *  6. 比率行：完整能力名（title 属性）、接受/拒绝两条 width 样式按
 *     acceptRate/rejectRate、文案 "NN% / NN%"（Math.round(rate*100)）
 *  7. 头部：useCapability 计数显示 totalBehaviors
 */

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import BehaviorStats, { BehaviorStats as NamedBehaviorStats } from "@/components/ai/BehaviorStats";

/** 造 n 个能力，total 依次为 10,9,8…，acceptRate 递减 */
function caps(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    capability: `cap-${i}`,
    total: n - i,
    useCount: n - i,
    acceptCount: Math.round((n - i) * 0.666),
    rejectCount: Math.round((n - i) * 0.2),
    editCount: 1,
    acceptRate: ((n - i) * 0.666) / (n - i), // 0.666
    rejectRate: 0.2,
  }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
});

describe("BehaviorStats", () => {
  it("具名导出与默认导出指向同一组件", () => {
    expect(BehaviorStats).toBe(NamedBehaviorStats);
  });

  it('空数据态：role=img + BarChart3 + t("noRecommendations")，无图表', () => {
    const { container } = render(<BehaviorStats capabilities={[]} totalBehaviors={0} />);
    const empty = screen.getByRole("img");
    expect(empty.getAttribute("aria-label")).toBe("ai.aiPersonalization:stats");
    expect(empty.textContent).toContain("ai.aiPersonalization:noRecommendations");
    expect(container.querySelector(".lucide-bar-chart-3")).toBeTruthy();
    // 图表 svg（viewBox 600×240）不渲染——空态里唯一的 svg 是 lucide 图标
    expect(container.querySelector('svg[viewBox="0 0 600 240"]')).toBeNull();
    expect(container.querySelector('span[title^="cap-"]')).toBeNull();
  });

  it("有数据时渲染 section（aria-label=stats）与图表 svg（aria-label=capability）", () => {
    const { container } = render(<BehaviorStats capabilities={caps(2)} totalBehaviors={7} />);
    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-label")).toBe("ai.aiPersonalization:stats");
    expect(
      container.querySelector('svg[aria-label="ai.aiPersonalization:capability"]'),
    ).toBeTruthy();
    // 头部计数
    expect(screen.getByText("ai.aiPersonalization:useCapability: 7")).toBeTruthy();
    expect(container.querySelector(".lucide-bar-chart-3")).toBeTruthy();
  });

  it("柱状图最多 8 个能力：10 个能力只画 8 根柱、比率行也只有 8 条", () => {
    const { container } = render(<BehaviorStats capabilities={caps(10)} totalBehaviors={100} />);
    const bars = container.querySelectorAll('rect[fill="var(--accent)"]');
    expect(bars.length).toBe(8);
    // 第 9/10 个能力不进比率行（cap-9 只可能出现在被截断的 X 标签里——不会，因为也截了）
    expect(screen.queryByText("cap-9")).toBeNull();
    // 比率行：每行一个 title=cap-N 的 span
    const rateRows = container.querySelectorAll('span[title^="cap-"]');
    expect(rateRows.length).toBe(8);
    expect(rateRows[0].getAttribute("title")).toBe("cap-0");
  });

  it("柱高按 total/maxCount 等比：max 柱满高 160，半值柱 80", () => {
    const data = [
      {
        ...caps(1)[0],
        capability: "max-cap",
        total: 10,
        useCount: 10,
        acceptCount: 6,
        rejectCount: 2,
        acceptRate: 0.6,
        rejectRate: 0.2,
      },
      {
        ...caps(1)[0],
        capability: "half-cap",
        total: 5,
        useCount: 5,
        acceptCount: 3,
        rejectCount: 1,
        acceptRate: 0.6,
        rejectRate: 0.2,
      },
    ];
    const { container } = render(<BehaviorStats capabilities={data} totalBehaviors={15} />);
    const bars = container.querySelectorAll('rect[fill="var(--accent)"]');
    expect(bars.length).toBe(2);
    // plotHeight = 240 - 20 - 60 = 160；maxCount = 10
    expect(Number(bars[0].getAttribute("height"))).toBe(160);
    expect(Number(bars[1].getAttribute("height"))).toBe(80);
    expect(Number(bars[0].getAttribute("y"))).toBe(20);
    expect(Number(bars[1].getAttribute("y"))).toBe(100);
  });

  it('柱子 <title> 形如 "capability: total"，柱顶有数值标签', () => {
    const { container } = render(<BehaviorStats capabilities={caps(3)} totalBehaviors={6} />);
    const titles = Array.from(container.querySelectorAll("rect title")).map((n) => n.textContent);
    expect(titles).toEqual(["cap-0: 3", "cap-1: 2", "cap-2: 1"]);
    // 柱顶数值（fontSize=10 的 text，与 Y 轴刻度 fontSize=11 区分）
    const barLabels = Array.from(container.querySelectorAll('text[font-size="10"]')).map(
      (n) => n.textContent,
    );
    expect(barLabels).toContain("3");
    expect(barLabels).toContain("2");
    expect(barLabels).toContain("1");
  });

  it('X 轴标签超 12 字符截断为 12 字符 + "…"', () => {
    const long = { ...caps(1)[0], capability: "task-breakdown-summary-report-x", total: 2 };
    const { container } = render(<BehaviorStats capabilities={[long]} totalBehaviors={2} />);
    const labels = Array.from(container.querySelectorAll('text[font-size="10"]')).map(
      (n) => n.textContent,
    );
    // slice(0,12) = "task-breakdo"（12 字符）+ "…"
    expect(labels).toContain("task-breakdo…");
    expect(labels).not.toContain("task-breakdown-summary-report-x");
    // 比率行仍用**完整**能力名（title 属性 + 文本）
    expect(
      container.querySelector('span[title="task-breakdown-summary-report-x"]')?.textContent,
    ).toBe("task-breakdown-summary-report-x");
  });

  it("Y 轴 5 个刻度（4 等分）：0 到 maxCount", () => {
    const { container } = render(<BehaviorStats capabilities={caps(1)} totalBehaviors={1} />);
    // maxCount = 1 → 刻度 Math.round(1*i/4)：0,0,1,1,0？Math.round(0.25)=0、0.5→1（银行家舍入？Math.round(0.5)=1）
    const tickTexts = Array.from(container.querySelectorAll('text[font-size="11"]')).map(
      (n) => n.textContent,
    );
    expect(tickTexts.length).toBe(5);
    expect(tickTexts[0]).toBe("0");
    expect(tickTexts[4]).toBe("1");
  });

  it('比率行：接受/拒绝条宽按 rate，文案 "NN% / NN%"', () => {
    const data = [
      {
        capability: "alpha",
        total: 3,
        useCount: 3,
        acceptCount: 2,
        rejectCount: 1,
        editCount: 0,
        acceptRate: 0.6666,
        rejectRate: 0.2,
      },
    ];
    const { container } = render(<BehaviorStats capabilities={data} totalBehaviors={3} />);
    // 容器是 h-[6px]，两条内部分别是 h-full 的接受/拒绝条
    const bars = container.querySelectorAll(".h-full");
    expect(bars.length).toBe(2);
    expect((bars[0] as HTMLElement).style.width).toBe("66.66%");
    expect((bars[1] as HTMLElement).style.width).toBe("20%");
    // Math.round(0.6666*100)=67、Math.round(0.2*100)=20
    expect(screen.getByText("67% / 20%")).toBeTruthy();
    // 表头：acceptSuggestion / rejectSuggestion（带图标）
    expect(screen.getByText("ai.aiPersonalization:acceptSuggestion")).toBeTruthy();
    expect(screen.getByText("ai.aiPersonalization:rejectSuggestion")).toBeTruthy();
    expect(container.querySelector(".lucide-check-circle-2")).toBeTruthy();
    expect(container.querySelector(".lucide-x-circle")).toBeTruthy();
  });
});
