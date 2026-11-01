// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { ProgressSteps } from "@/components/ai/ProgressSteps";

/**
 * AI 流式进度步骤指示器契约（components/ai/ProgressSteps.tsx）：
 *  - 容器 role=status + aria-live=polite（读屏可播报进度）
 *  - 三行阶段按 stageNames 顺序渲染
 *  - 图标语义：已完成（stage < current）→ CheckCircle2；当前（=）→ Loader2（animate-spin 且
 *    motion-reduce 下停转）；未开始（>）→ Circle
 *  - 当前阶段消息只显示在**当前**行；未传消息不渲染任何消息节点
 */
const STAGES: [string, string, string] = ["聚合数据", "分析", "生成"];

const rowIcons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(":scope > div > div")).map((row) => {
    const svg = row.querySelector("svg");
    const cls = svg?.getAttribute("class") ?? "";
    if (cls.includes("lucide-check-circle")) return "done";
    if (cls.includes("lucide-loader-2")) return "current";
    if (cls.includes("lucide-circle")) return "pending";
    return "unknown";
  });

describe("ProgressSteps", () => {
  it("容器语义：role=status + aria-live=polite", () => {
    const { container } = render(<ProgressSteps currentStage={1} stageNames={STAGES} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("role")).toBe("status");
    expect(root.getAttribute("aria-live")).toBe("polite");
  });

  it("阶段名按传入顺序渲染（3 行）", () => {
    const { getByText } = render(<ProgressSteps currentStage={2} stageNames={STAGES} />);
    expect(getByText("聚合数据")).toBeTruthy();
    expect(getByText("分析")).toBeTruthy();
    expect(getByText("生成")).toBeTruthy();
  });

  it("stage=1：当前在第一行（spinner），其余未开始（空心圆）", () => {
    const { container } = render(<ProgressSteps currentStage={1} stageNames={STAGES} />);
    expect(rowIcons(container)).toEqual(["current", "pending", "pending"]);
  });

  it("stage=2：第一行已完成（打勾）、第二行当前、第三行未开始", () => {
    const { container } = render(<ProgressSteps currentStage={2} stageNames={STAGES} />);
    expect(rowIcons(container)).toEqual(["done", "current", "pending"]);
  });

  it("stage=3：前两行已完成、末行当前", () => {
    const { container } = render(<ProgressSteps currentStage={3} stageNames={STAGES} />);
    expect(rowIcons(container)).toEqual(["done", "done", "current"]);
  });

  it("spinner 带 animate-spin 且 motion-reduce 下停转（无障碍）", () => {
    const { container } = render(<ProgressSteps currentStage={1} stageNames={STAGES} />);
    const spinner = container.querySelector("svg.lucide-loader-2");
    expect(spinner).toBeTruthy();
    expect(spinner!.getAttribute("class")).toContain("animate-spin");
    expect(spinner!.getAttribute("class")).toContain("motion-reduce:animate-none");
  });

  it("当前阶段消息只出现在当前行；未传消息时不渲染消息节点", () => {
    const withMsg = render(
      <ProgressSteps currentStage={2} stageNames={STAGES} currentMessage="正在分析风险" />,
    );
    const msgNodes = withMsg.container.querySelectorAll("span");
    const texts = Array.from(msgNodes).map((n) => n.textContent);
    // 三个阶段名 + 一条当前消息
    expect(texts.filter((t) => t === "正在分析风险")).toHaveLength(1);
    expect(texts.filter((t) => t === "分析")).toHaveLength(1);
    // 消息挂在"分析"（当前）那一行
    const currentRow = Array.from(withMsg.container.querySelectorAll(":scope > div > div")).find(
      (row) => row.textContent?.includes("正在分析风险"),
    );
    expect(currentRow?.textContent).toContain("分析");
    withMsg.unmount();

    const noMsg = render(<ProgressSteps currentStage={3} stageNames={STAGES} />);
    expect(noMsg.container.textContent).toBe("聚合数据分析生成");
    noMsg.unmount();
  });
});
