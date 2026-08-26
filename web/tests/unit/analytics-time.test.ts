import { describe, it, expect } from "vitest";

/**
 * analytics-time 单元测试（D1 修复：Asia/Shanghai 日界）
 *
 * 验证：
 *  - shanghaiDay：北京时间 00:00±1min 的 UTC 时刻分桶归属正确日
 *  - shanghaiWeekKey：周日 23:30(UTC+8) 与周一 00:30(UTC+8) 分属不同周
 *  - CORE_EVENTS 集合内容
 */
import { shanghaiDay, shanghaiWeekKey, CORE_EVENTS } from "@/lib/analytics-time";

describe("shanghaiDay", () => {
  it("UTC 16:00 当日 → 北京次日 00:00 → 归次日", () => {
    // UTC 2026-08-27T16:00:00Z = 北京 2026-08-28T00:00:00
    const d = new Date("2026-08-27T16:00:00Z");
    expect(shanghaiDay(d)).toBe("2026-08-28");
  });

  it("UTC 15:59 当日 → 北京当日 23:59 → 归当日", () => {
    // UTC 2026-08-27T15:59:00Z = 北京 2026-08-27T23:59:00
    const d = new Date("2026-08-27T15:59:00Z");
    expect(shanghaiDay(d)).toBe("2026-08-27");
  });

  it("UTC 00:00 当日 → 北京当日 08:00 → 归当日", () => {
    const d = new Date("2026-08-27T00:00:00Z");
    expect(shanghaiDay(d)).toBe("2026-08-27");
  });

  it("北京时间 07:30（UTC 前一日 23:30）归北京当日", () => {
    // UTC 2026-08-26T23:30:00Z = 北京 2026-08-27T07:30:00
    const d = new Date("2026-08-26T23:30:00Z");
    expect(shanghaiDay(d)).toBe("2026-08-27");
  });
});

describe("shanghaiWeekKey", () => {
  it("周日 23:30(UTC+8) 与周一 00:30(UTC+8) 分属不同周", () => {
    // 北京 2026-08-30 周日 23:30 = UTC 2026-08-30T15:30:00Z
    const sunday = new Date("2026-08-30T15:30:00Z");
    // 北京 2026-08-31 周一 00:30 = UTC 2026-08-30T16:30:00Z
    const monday = new Date("2026-08-30T16:30:00Z");
    expect(shanghaiWeekKey(sunday)).not.toBe(shanghaiWeekKey(monday));
  });

  it("同一周内两天归同一周 key", () => {
    // 北京 2026-08-31 周一 10:00 = UTC 2026-08-31T02:00:00Z
    const mon = new Date("2026-08-31T02:00:00Z");
    // 北京 2026-09-04 周五 18:00 = UTC 2026-09-04T10:00:00Z
    const fri = new Date("2026-09-04T10:00:00Z");
    expect(shanghaiWeekKey(mon)).toBe(shanghaiWeekKey(fri));
  });

  it("周 key 格式为 YYYY-MM-DD（周一日期，稳定可比较）", () => {
    const d = new Date("2026-08-31T02:00:00Z"); // 北京周一
    expect(shanghaiWeekKey(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(shanghaiWeekKey(d)).toBe("2026-08-31");
  });
});

describe("CORE_EVENTS", () => {
  it("含 6 个核心行为事件", () => {
    expect(CORE_EVENTS.size).toBe(6);
    expect(CORE_EVENTS.has("session_start")).toBe(true);
    expect(CORE_EVENTS.has("create_task")).toBe(true);
    expect(CORE_EVENTS.has("task_status_change")).toBe(true);
    expect(CORE_EVENTS.has("create_comment")).toBe(true);
    expect(CORE_EVENTS.has("create_decision")).toBe(true);
    expect(CORE_EVENTS.has("invite_member")).toBe(true);
  });

  it("排除低价值信号", () => {
    expect(CORE_EVENTS.has("page_view")).toBe(false);
    expect(CORE_EVENTS.has("workspace_switch")).toBe(false);
    expect(CORE_EVENTS.has("login_success")).toBe(false);
  });
});
