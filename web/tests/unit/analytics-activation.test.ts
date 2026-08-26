import { describe, it, expect } from "vitest";

/**
 * analytics-activation 单元测试（P2-1 失败隔离 + 布尔矩阵）
 *
 * 验证：
 *  - shouldActivate 各条件边界：dup>0 不写；minutes=15.0 写/15.01 不写；
 *    selfAssigned=true 不写；isFirstTask=false 不写；全满足写
 */
import { shouldActivate } from "@/lib/analytics-activation";

describe("shouldActivate - 布尔矩阵", () => {
  it("全满足 → true", () => {
    expect(
      shouldActivate({
        isFirstTask: true,
        assignedToOther: true,
        minutesSinceRegister: 10,
        dupCount: 0,
      }),
    ).toBe(true);
  });

  it("dupCount > 0 → false（已激活过，幂等）", () => {
    expect(
      shouldActivate({
        isFirstTask: true,
        assignedToOther: true,
        minutesSinceRegister: 10,
        dupCount: 1,
      }),
    ).toBe(false);
  });

  it("minutesSinceRegister = 15.0 → true（边界含）", () => {
    expect(
      shouldActivate({
        isFirstTask: true,
        assignedToOther: true,
        minutesSinceRegister: 15.0,
        dupCount: 0,
      }),
    ).toBe(true);
  });

  it("minutesSinceRegister = 15.01 → false（边界外）", () => {
    expect(
      shouldActivate({
        isFirstTask: true,
        assignedToOther: true,
        minutesSinceRegister: 15.01,
        dupCount: 0,
      }),
    ).toBe(false);
  });

  it("assignedToOther = false（自派）→ false", () => {
    expect(
      shouldActivate({
        isFirstTask: true,
        assignedToOther: false,
        minutesSinceRegister: 10,
        dupCount: 0,
      }),
    ).toBe(false);
  });

  it("isFirstTask = false（第二任务）→ false", () => {
    expect(
      shouldActivate({
        isFirstTask: false,
        assignedToOther: true,
        minutesSinceRegister: 10,
        dupCount: 0,
      }),
    ).toBe(false);
  });

  it("minutesSinceRegister = 0 → true（注册瞬间）", () => {
    expect(
      shouldActivate({
        isFirstTask: true,
        assignedToOther: true,
        minutesSinceRegister: 0,
        dupCount: 0,
      }),
    ).toBe(true);
  });

  it("minutesSinceRegister 负数（时钟偏移）→ true（保守不拒）", () => {
    expect(
      shouldActivate({
        isFirstTask: true,
        assignedToOther: true,
        minutesSinceRegister: -1,
        dupCount: 0,
      }),
    ).toBe(true);
  });
});

/**
 * P2-1 失败隔离：判定块任一查询/写入抛错均静默，主接口仍 201。
 * 这里以 shouldActivate 纯函数不抛错为代理验证（路由层 try-catch 由集成测试覆盖）。
 */
describe("shouldActivate - 失败隔离（P2-1）", () => {
  it("纯函数对任意输入不抛错", () => {
    expect(() =>
      shouldActivate({
        isFirstTask: true,
        assignedToOther: true,
        minutesSinceRegister: NaN,
        dupCount: 0,
      }),
    ).not.toThrow();
    expect(() =>
      shouldActivate({
        isFirstTask: true,
        assignedToOther: true,
        minutesSinceRegister: Infinity,
        dupCount: 0,
      }),
    ).not.toThrow();
  });
});
