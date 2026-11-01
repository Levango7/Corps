// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

import { Avatar, DURATION_HOURS, durationKey, formatExpiry } from "@/components/members/helpers";

/**
 * 成员管理共享辅助契约（components/members/helpers.tsx）：
 *  - DURATION_HOURS 六档（1/4/8/24/48/168 小时）且 durationKey 有对应 key；未知值回退 24h
 *  - formatExpiry：过期→expired；≥1 天→days；≥1 小时→hours；否则 minutes（边界用假时钟）
 *  - Avatar：取 name[0] 大写、name 为空回退 email[0]、空值不抛
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

describe("DURATION_HOURS / durationKey", () => {
  it("六档与 i18n key 一一对应", () => {
    expect(DURATION_HOURS).toEqual([1, 4, 8, 24, 48, 168]);
    expect(DURATION_HOURS.map(durationKey)).toEqual([
      "duration1h",
      "duration4h",
      "duration8h",
      "duration24h",
      "duration48h",
      "duration7d",
    ]);
  });

  it("未知小时数回退 duration24h", () => {
    expect(durationKey(2)).toBe("duration24h");
    expect(durationKey(0)).toBe("duration24h");
    expect(durationKey(-1)).toBe("duration24h");
  });
});

describe("formatExpiry", () => {
  const at = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

  it("已过期（含恰好到期）：tempGrantExpired", () => {
    expect(formatExpiry(at(-1000), t)).toBe("tempGrantExpired");
    expect(formatExpiry(at(0), t)).toBe("tempGrantExpired");
  });

  it("≥1 天：按天（向下取整，含复数变量）", () => {
    expect(formatExpiry(at(3 * 24 * 3600_000), t)).toBe('tempGrantExpiryDays:{"count":3}');
    // 1.5 天 → 1 天（floor）
    expect(formatExpiry(at(1.5 * 24 * 3600_000), t)).toBe('tempGrantExpiryDays:{"count":1}');
  });

  it("≥1 小时且 <1 天：按小时", () => {
    expect(formatExpiry(at(5 * 3600_000), t)).toBe('tempGrantExpiryHours:{"count":5}');
    expect(formatExpiry(at(0.5 * 3600_000), t)).toBe('tempGrantExpiryMinutes:{"count":30}');
  });

  it("不足 1 小时：按分钟", () => {
    expect(formatExpiry(at(5 * 60_000), t)).toBe('tempGrantExpiryMinutes:{"count":5}');
    expect(formatExpiry(at(30_000), t)).toBe('tempGrantExpiryMinutes:{"count":0}');
  });
});

describe("Avatar", () => {
  it("取 name 首字母大写", () => {
    const { container } = render(<Avatar m={{ name: "alice" } as never} />);
    expect(container.textContent).toBe("A");
  });

  it("name 为空回退 email 首字母", () => {
    const { container } = render(<Avatar m={{ name: "", email: "bob@x.io" } as never} />);
    expect(container.textContent).toBe("B");
  });

  it("二者皆空串：渲染空文本不抛（类型契约上 email 必填）", () => {
    // 注：若 name 与 email 同时缺失（undefined）实现会抛——但 Member 类型要求 email 必填，
    // 该形态不在契约内；此处测合法边角（空串）。
    const { container } = render(<Avatar m={{ name: "", email: "" } as never} />);
    expect(container.textContent).toBe("");
  });
});
