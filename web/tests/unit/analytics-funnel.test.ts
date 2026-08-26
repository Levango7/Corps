import { describe, it, expect } from "vitest";

/**
 * analytics-funnel 单元测试（D2 修复：序列化漏斗匹配器）
 *
 * 验证：
 *  - 乱序输入排序后匹配
 *  - 跳步（无 landing 直达 submit）计入 submit/success 两步
 *  - 同事件多次取首个满足 ≥prev 的实例
 *  - sid=null 组只计末步（不参与串联）
 *  - 各步计数与转化率
 */
import { matchFunnel, type FunnelEvent } from "@/lib/analytics-funnel";

const STEPS = [
  { name: "landing_view", label: "落地曝光" },
  { name: "click_signup", label: "点击注册" },
  { name: "register_submit", label: "提交注册" },
  { name: "register_success", label: "注册成功" },
];

function ev(name: string, groupKey: string, iso: string): FunnelEvent {
  return { name, groupKey, createdAt: new Date(iso) };
}

describe("matchFunnel - 完整序列", () => {
  it("完整四步序列各步计数 1，转化率 100%", () => {
    const events = [
      ev("landing_view", "s1", "2026-08-27T10:00:00Z"),
      ev("click_signup", "s1", "2026-08-27T10:01:00Z"),
      ev("register_submit", "s1", "2026-08-27T10:02:00Z"),
      ev("register_success", "s1", "2026-08-27T10:03:00Z"),
    ];
    const result = matchFunnel(events, STEPS);
    expect(result.map((r) => r.users)).toEqual([1, 1, 1, 1]);
    expect(result.map((r) => r.rate)).toEqual([100, 100, 100, 100]);
  });
});

describe("matchFunnel - 跳步", () => {
  it("直达 submit（无 landing/click）→ submit/success 两步计入", () => {
    const events = [
      ev("register_submit", "s1", "2026-08-27T10:02:00Z"),
      ev("register_success", "s1", "2026-08-27T10:03:00Z"),
    ];
    const result = matchFunnel(events, STEPS);
    // landing/click 未发生 → 0；submit/success 计入
    expect(result.map((r) => r.users)).toEqual([0, 0, 1, 1]);
  });

  it("漏中间步（landing → submit → success，跳过 click）→ click=0，submit/success 仍计入（允许跳步）", () => {
    const events = [
      ev("landing_view", "s1", "2026-08-27T10:00:00Z"),
      ev("register_submit", "s1", "2026-08-27T10:02:00Z"),
      ev("register_success", "s1", "2026-08-27T10:03:00Z"),
    ];
    const result = matchFunnel(events, STEPS);
    // 允许跳步：landing 匹配（prevTime=10:00），click 找不到（0，prevTime 不变），
    // submit 找 ≥10:00 找到 10:02（1），success 找到（1）
    expect(result.map((r) => r.users)).toEqual([1, 0, 1, 1]);
  });
});

describe("matchFunnel - 乱序输入", () => {
  it("乱序输入按 createdAt 排序后匹配", () => {
    const events = [
      ev("register_success", "s1", "2026-08-27T10:03:00Z"),
      ev("landing_view", "s1", "2026-08-27T10:00:00Z"),
      ev("register_submit", "s1", "2026-08-27T10:02:00Z"),
      ev("click_signup", "s1", "2026-08-27T10:01:00Z"),
    ];
    const result = matchFunnel(events, STEPS);
    expect(result.map((r) => r.users)).toEqual([1, 1, 1, 1]);
  });
});

describe("matchFunnel - 多分组", () => {
  it("两个完整会话各步计数 2", () => {
    const events = [
      ev("landing_view", "s1", "2026-08-27T10:00:00Z"),
      ev("click_signup", "s1", "2026-08-27T10:01:00Z"),
      ev("register_submit", "s1", "2026-08-27T10:02:00Z"),
      ev("register_success", "s1", "2026-08-27T10:03:00Z"),
      ev("landing_view", "s2", "2026-08-27T11:00:00Z"),
      ev("click_signup", "s2", "2026-08-27T11:01:00Z"),
      ev("register_submit", "s2", "2026-08-27T11:02:00Z"),
      ev("register_success", "s2", "2026-08-27T11:03:00Z"),
    ];
    const result = matchFunnel(events, STEPS);
    expect(result.map((r) => r.users)).toEqual([2, 2, 2, 2]);
  });

  it("一个完整 + 一个仅末步 → 末步 2，其余 1", () => {
    const events = [
      ev("landing_view", "s1", "2026-08-27T10:00:00Z"),
      ev("click_signup", "s1", "2026-08-27T10:01:00Z"),
      ev("register_submit", "s1", "2026-08-27T10:02:00Z"),
      ev("register_success", "s1", "2026-08-27T10:03:00Z"),
      // s2 直达 success（无前序）
      ev("register_success", "s2", "2026-08-27T11:03:00Z"),
    ];
    const result = matchFunnel(events, STEPS);
    expect(result.map((r) => r.users)).toEqual([1, 1, 1, 2]);
  });
});

describe("matchFunnel - null 分组", () => {
  it("groupKey 为 null 的历史事件只计末步、不参与串联", () => {
    const events = [
      // null 组：仅有 register_success（历史/异常注册，未携带 sessionId）
      ev("register_success", "null", "2026-08-27T10:03:00Z"),
    ];
    const result = matchFunnel(events, STEPS);
    // null 组只计末步：landing/click/submit=0，success=1
    expect(result.map((r) => r.users)).toEqual([0, 0, 0, 1]);
  });
});

describe("matchFunnel - 转化率", () => {
  it("转化率 = 当前步 / 上一步（百分比取整）", () => {
    const events = [
      // 3 个 landing，2 个 click，1 个 submit，1 个 success
      ev("landing_view", "s1", "2026-08-27T10:00:00Z"),
      ev("click_signup", "s1", "2026-08-27T10:01:00Z"),
      ev("register_submit", "s1", "2026-08-27T10:02:00Z"),
      ev("register_success", "s1", "2026-08-27T10:03:00Z"),
      ev("landing_view", "s2", "2026-08-27T11:00:00Z"),
      ev("click_signup", "s2", "2026-08-27T11:01:00Z"),
      ev("landing_view", "s3", "2026-08-27T12:00:00Z"),
    ];
    const result = matchFunnel(events, STEPS);
    expect(result.map((r) => r.users)).toEqual([3, 2, 1, 1]);
    // rate[0] = users[0]/users[0] = 100
    // rate[1] = users[1]/users[0] = 2/3 = 67
    // rate[2] = users[2]/users[1] = 1/2 = 50
    // rate[3] = users[3]/users[2] = 1/1 = 100
    expect(result.map((r) => r.rate)).toEqual([100, 67, 50, 100]);
  });

  it("上一步为 0 时转化率为 0（避免除零）", () => {
    const events = [ev("register_success", "s1", "2026-08-27T10:03:00Z")];
    const result = matchFunnel(events, STEPS);
    expect(result.map((r) => r.rate)).toEqual([0, 0, 0, 0]);
  });
});
