import { describe, it, expect } from "vitest";
import { computeProgress } from "@/lib/okr";

describe("computeProgress - OKR 进度计算", () => {
  it("空数组返回 0", () => {
    expect(computeProgress([])).toBe(0);
  });

  it("单个 KR 100% 完成 → 100", () => {
    expect(
      computeProgress([{ currentValue: 100, targetValue: 100, weight: 1 }]),
    ).toBe(100);
  });

  it("单个 KR 50% 完成 → 50", () => {
    expect(
      computeProgress([{ currentValue: 50, targetValue: 100, weight: 1 }]),
    ).toBe(50);
  });

  it("单个 KR 0% 完成 → 0", () => {
    expect(
      computeProgress([{ currentValue: 0, targetValue: 100, weight: 1 }]),
    ).toBe(0);
  });

  it("targetValue=0 的 KR 进度计为 0（避免除零）", () => {
    expect(
      computeProgress([{ currentValue: 10, targetValue: 0, weight: 1 }]),
    ).toBe(0);
  });

  it("总权重为 0 时进度为 0", () => {
    expect(
      computeProgress([
        { currentValue: 50, targetValue: 100, weight: 0 },
        { currentValue: 30, targetValue: 100, weight: 0 },
      ]),
    ).toBe(0);
  });

  it("多个 KR 按权重加权平均", () => {
    // KR1: 80/100=0.8, weight=2 → 1.6
    // KR2: 40/100=0.4, weight=1 → 0.4
    // total: (1.6+0.4)/(2+1) * 100 = 200/3 ≈ 66.67
    const result = computeProgress([
      { currentValue: 80, targetValue: 100, weight: 2 },
      { currentValue: 40, targetValue: 100, weight: 1 },
    ]);
    expect(result).toBeCloseTo(66.67, 1);
  });

  it("进度超过 100 时钳制为 100", () => {
    expect(
      computeProgress([{ currentValue: 200, targetValue: 100, weight: 1 }]),
    ).toBe(100);
  });

  it("进度为负数时钳制为 0", () => {
    expect(
      computeProgress([{ currentValue: -50, targetValue: 100, weight: 1 }]),
    ).toBe(0);
  });

  it("混合 targetValue=0 和正常 KR", () => {
    // KR1: 50/100=0.5, weight=1 → 0.5
    // KR2: targetValue=0 → 0, weight=1 → 0
    // total: (0.5+0)/(1+1) * 100 = 25
    const result = computeProgress([
      { currentValue: 50, targetValue: 100, weight: 1 },
      { currentValue: 10, targetValue: 0, weight: 1 },
    ]);
    expect(result).toBe(25);
  });

  it("所有 KR 100% 完成 → 100", () => {
    expect(
      computeProgress([
        { currentValue: 100, targetValue: 100, weight: 1 },
        { currentValue: 50, targetValue: 50, weight: 2 },
      ]),
    ).toBe(100);
  });
});