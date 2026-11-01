// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * 燃尽图契约（components/ai/BurndownChart.tsx）：纯 SVG、无外部图表库。
 *  1. 双线皆空 → role=img + t("noReports")，无 svg
 *  2. 坐标系：X 取两线日期并集排序；VIEW 800×400、PADDING 30/30/50/50
 *     （plotWidth=720、plotHeight=320）；路径坐标 M/L 串联、缺失日期的点被跳过
 *  3. 理想线虚线 dasharray 6,4（var(--border)），实际线实线 var(--accent) 2.5 +
 *     r=3 数据点圆
 *  4. Y 轴 6 刻度（5 等分，含 0 与 maxY）；X 标签稀疏化（step=ceil(n/8)，
 *     必显示首、末）；shortDate 把 YYYY-MM-DD 压成 MM-DD，不足 3 段原样返回
 *  5. 单日期 → x 居中（plotWidth/2）
 *  6. predictedCompletion 命中并集日期 → 绿色虚线竖线 + r=5 圆 + MM-DD 标签；
 *     未命中 → 不渲染
 *  7. 图例：ideal / actual 两行
 */

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`,
}));

import BurndownChart, {
  BurndownChart as NamedBurndownChart,
  type BurndownPoint,
} from "@/components/ai/BurndownChart";

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
});

/** 计算坐标系（与组件同式，供断言引用） */
const VIEW_W = 800;
const PAD = { top: 30, right: 30, bottom: 50, left: 50 };
const plotW = VIEW_W - PAD.left - PAD.right;

describe("BurndownChart", () => {
  it("具名导出与默认导出指向同一组件", () => {
    expect(BurndownChart).toBe(NamedBurndownChart);
  });

  it('双线皆空 → role=img + t("noReports")，无 svg', () => {
    const { container } = render(<BurndownChart idealLine={[]} actualLine={[]} />);
    const empty = screen.getByRole("img");
    expect(empty.getAttribute("aria-label")).toBe("ai.aiAnalysis:burndown");
    expect(empty.textContent).toContain("ai.aiAnalysis:noReports");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("只有一条线也算非空：渲染 svg 与图例", () => {
    const ideal: BurndownPoint[] = [{ date: "2026-10-01", remaining: 4 }];
    const { container } = render(<BurndownChart idealLine={ideal} actualLine={[]} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("ai.aiAnalysis:burndown (ideal)")).toBeTruthy();
    expect(screen.getByText("ai.aiAnalysis:burndown (actual)")).toBeTruthy();
  });

  it("路径坐标：X 取并集、按 maxY 归一；理想/实际 d 可复算", () => {
    const ideal: BurndownPoint[] = [
      { date: "2026-10-01", remaining: 10 },
      { date: "2026-10-02", remaining: 0 },
    ];
    const actual: BurndownPoint[] = [
      { date: "2026-10-01", remaining: 10 },
      { date: "2026-10-03", remaining: 2 },
    ];
    const { container } = render(<BurndownChart idealLine={ideal} actualLine={actual} />);
    // 并集 3 日 → 0→x50、1→x410、2→x770；maxY=10 → y(0)=350、y(2)=286、y(10)=30
    const idealPath = container.querySelector('path[stroke-dasharray="6,4"]');
    const actualPath = container.querySelector('path[stroke="var(--accent)"]');
    expect(idealPath?.getAttribute("d")).toBe("M50.0,30.0 L410.0,350.0");
    expect(actualPath?.getAttribute("d")).toBe("M50.0,30.0 L770.0,286.0");
    expect(idealPath?.getAttribute("fill")).toBe("none");
    expect(actualPath?.getAttribute("stroke-width")).toBe("2.5");
  });

  it("实际线数据点：r=3、var(--accent)、位置与 remaining 对应", () => {
    const actual: BurndownPoint[] = [
      { date: "2026-10-01", remaining: 10 },
      { date: "2026-10-03", remaining: 2 },
    ];
    const { container } = render(<BurndownChart idealLine={[]} actualLine={actual} />);
    const dots = Array.from(container.querySelectorAll('circle[r="3"]'));
    expect(dots.length).toBe(2);
    expect(dots[0].getAttribute("cx")).toBe("50");
    expect(dots[0].getAttribute("cy")).toBe("30");
    expect(dots[1].getAttribute("cx")).toBe("770");
    expect(dots[1].getAttribute("cy")).toBe("286");
  });

  it("Y 轴 6 刻度 5 等分（含 0 与 maxY=10）：0,2,4,6,8,10", () => {
    const line: BurndownPoint[] = [{ date: "2026-10-01", remaining: 10 }];
    const { container } = render(<BurndownChart idealLine={line} actualLine={line} />);
    const ticks = Array.from(container.querySelectorAll('text[font-size="11"]'))
      .filter((t) => !t.textContent?.includes("(ideal)"))
      .map((t) => t.textContent);
    // Y 刻度 + 图例两行（fontSize=11）+ 可能的预测标签 —— 只校验 Y 刻度本身存在
    expect(ticks).toEqual(expect.arrayContaining(["0", "2", "4", "6", "8", "10"]));
    const gridLines = container.querySelectorAll('line[stroke="var(--border-soft)"]');
    expect(gridLines.length).toBeGreaterThanOrEqual(6);
  });

  it("X 标签稀疏化：10 个日期只渲染首偶数步+末（step=ceil(10/8)=2 → 6 条）", () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const line: BurndownPoint[] = dates.map((d) => ({ date: d, remaining: 10 }));
    const { container } = render(<BurndownChart idealLine={line} actualLine={[]} />);
    // X 刻度短线：y1=350、y2=354（与 Y 网格线 y1=350 用 y2 区分）
    const xTicks = container.querySelectorAll('line[y2="354"]');
    expect(xTicks.length).toBe(6);
    // 显示的是 idx 0,2,4,6,8 与末位 9
    expect(screen.getByText("10-01")).toBeTruthy();
    expect(screen.getByText("10-05")).toBeTruthy();
    expect(screen.getByText("10-10")).toBeTruthy();
    // 被稀疏掉的是 idx 1,3,5,7
    expect(screen.queryAllByText("10-02")).toEqual([]);
    expect(screen.queryAllByText("10-06")).toEqual([]);
  });

  it('shortDate 不足 3 段时原样返回："10-01" 标签不被再压', () => {
    const line: BurndownPoint[] = [{ date: "10-01", remaining: 3 }];
    const { container } = render(<BurndownChart idealLine={line} actualLine={line} />);
    expect(screen.getByText("10-01")).toBeTruthy();
    // 坐标依然存在（plotH 内）
    const path = container.querySelector("path");
    expect(path?.getAttribute("d")).toContain(`M${PAD.left + plotW / 2}.0,`);
  });

  it("单日期 → X 居中（PAD.left + plotWidth/2 = 410）", () => {
    const line: BurndownPoint[] = [{ date: "2026-10-01", remaining: 5 }];
    const { container } = render(<BurndownChart idealLine={line} actualLine={[]} />);
    const path = container.querySelector("path");
    // maxY=5 → y = 30 + 320 - 320 = 30；x 居中 410
    expect(path?.getAttribute("d")).toBe("M410.0,30.0");
  });

  it("predictedCompletion 命中并集日期 → 绿色虚线 + r=5 圆 + MM-DD 标签", () => {
    const ideal: BurndownPoint[] = [
      { date: "2026-10-01", remaining: 10 },
      { date: "2026-10-03", remaining: 0 },
    ];
    const actual: BurndownPoint[] = [{ date: "2026-10-01", remaining: 10 }];
    const { container } = render(
      <BurndownChart idealLine={ideal} actualLine={actual} predictedCompletion="2026-10-03" />,
    );
    expect(container.querySelector('line[stroke="var(--success)"]')).toBeTruthy();
    const marker = container.querySelector('circle[r="5"]');
    expect(marker).toBeTruthy();
    // yScale(0) = 350；x 为第二个日期
    expect(marker?.getAttribute("cx")).toBe("770");
    expect(marker?.getAttribute("cy")).toBe("350");
    // "10-03" 出现两次：X 轴标签 + 预测标注
    expect(screen.getAllByText("10-03").length).toBe(2);
  });

  it("predictedCompletion 未命中并集日期 → 不渲染绿色标注", () => {
    const line: BurndownPoint[] = [{ date: "2026-10-01", remaining: 10 }];
    const { container } = render(
      <BurndownChart idealLine={line} actualLine={line} predictedCompletion="2026-12-31" />,
    );
    expect(container.querySelector('circle[r="5"]')).toBeNull();
    expect(container.querySelector('line[stroke="var(--success)"]')).toBeNull();
  });

  it("viewBox 响应式与背景绘图区", () => {
    const line: BurndownPoint[] = [{ date: "2026-10-01", remaining: 1 }];
    const { container } = render(<BurndownChart idealLine={line} actualLine={line} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 800 400");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("ai.aiAnalysis:burndown");
    // 背景 rect（surface-2）
    expect(container.querySelector('rect[fill="var(--surface-2)"]')).toBeTruthy();
  });
});
