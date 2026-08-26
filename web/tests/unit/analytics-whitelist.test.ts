import { describe, it, expect } from "vitest";

/**
 * analytics-whitelist 单元测试
 *
 * 验证：
 *  - 导出集合内容快照（含 32 名：20 旧 + 9 新 + 3 spec §8）
 *  - 无重复
 *  - 9 个新增事件名均在集合内
 *  - spec §8 三事件（定价线消费）均在集合内
 */
import { ALLOWED_EVENT_NAMES } from "@/lib/analytics-whitelist";

describe("analytics-whitelist", () => {
  it("含 32 名（20 旧 + 9 新 + 3 spec §8，集成验证补齐定价线三事件）", () => {
    expect(ALLOWED_EVENT_NAMES.size).toBe(32);
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
