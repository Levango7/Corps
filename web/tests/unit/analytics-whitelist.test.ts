import { describe, it, expect } from "vitest";

/**
 * analytics-whitelist 单元测试
 *
 * 验证：
 *  - 导出集合规模（当前 37 名：20 旧 + 9 新 + 3 spec §8 + 2 筛选视图 + 3 闭环/导出）
 *  - 无重复
 *  - 9 个新增事件名均在集合内
 *  - spec §8 三事件（定价线消费）均在集合内
 *  - 筛选与自定义视图两事件（阶段 2-2）均在集合内
 */
import { ALLOWED_EVENT_NAMES } from "@/lib/analytics-whitelist";

describe("analytics-whitelist", () => {
  /**
   * 计数是**字面量**：扩白名单必须是一次有意识的行为。
   * 与 lib/analytics-whitelist.ts 头部注释的「计数：N 名」是两处独立的声明，
   * 由 tests/unit/analytics-event-contract.test.ts 断言「注释数字 == 集合大小」，
   * 所以漏改任一处都会红：这里挡「加了名字没更新预期」，契约测试挡「加了名字没回写注释」。
   */
  it("含 37 名（20 旧 + 9 新 + 3 spec §8 + 2 筛选视图 + 3 闭环/导出）", () => {
    expect(ALLOWED_EVENT_NAMES.size).toBe(37);
  });

  it("9 个新增事件名均在集合内", () => {
    const newNames = [
      "landing_view",
      "click_signup",
      "session_start",
      "activation_completed",
      "invite_accepted",
      "subscription_activated",
      "payment_failed",
      "subscription_renewed",
      "subscription_churned",
    ];
    for (const name of newNames) {
      expect(ALLOWED_EVENT_NAMES.has(name)).toBe(true);
    }
  });

  it("spec §8 三事件（定价线消费）均在集合内", () => {
    const specNames = ["view_pricing", "select_billing_period", "click_upgrade"];
    for (const name of specNames) {
      expect(ALLOWED_EVENT_NAMES.has(name)).toBe(true);
    }
  });

  it("20 个旧事件名均在集合内", () => {
    const oldNames = [
      "register_view",
      "register_submit",
      "register_success",
      "login_view",
      "login_submit",
      "login_success",
      "onboarding_start",
      "onboarding_complete",
      "onboarding_skip",
      "create_task",
      "invite_member",
      "create_decision",
      "create_comment",
      "task_status_change",
      "page_view",
      "workspace_switch",
      "billing_view",
      "billing_checkout",
      "billing_success",
      "billing_cancel",
    ];
    expect(oldNames.length).toBe(20);
    for (const name of oldNames) {
      expect(ALLOWED_EVENT_NAMES.has(name)).toBe(true);
    }
  });

  it("非法事件名不在集合内", () => {
    expect(ALLOWED_EVENT_NAMES.has("random_event")).toBe(false);
    expect(ALLOWED_EVENT_NAMES.has("")).toBe(false);
    expect(ALLOWED_EVENT_NAMES.has("register")).toBe(false);
  });
});
