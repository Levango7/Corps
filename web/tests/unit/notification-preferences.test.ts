// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * 通知偏好判定（lib/notification/preferences.ts）
 *
 * 这个模块的存在理由：notification_preferences 表此前只有未接线的
 * lib/notification/offline-push.ts 在读，设置页开关不改变任何在跑的行为。
 * 因此这里的断言聚焦"开关语义真的能挡住投递"，而不是对象形状。
 */

vi.mock("@/lib/prisma", () => ({
  prisma: { notificationPreference: { upsert: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import {
  getNotificationPreferences,
  isDndActive,
  shouldSendEmail,
  shouldSendPush,
  type NotifyPreference,
} from "@/lib/notification/preferences";

const upsertMock = vi.mocked(prisma.notificationPreference.upsert);

function pref(overrides: Partial<NotifyPreference> = {}): NotifyPreference {
  return {
    emailNotify: true,
    pushNotify: true,
    dndEnabled: false,
    dndStart: "22:00",
    dndEnd: "08:00",
    ...overrides,
  };
}

/** 把系统时钟钉到给定小时（本地时区、30 分），使 DND 断言与"现在几点"无关 */
function atHour(hour: number) {
  const d = new Date();
  d.setHours(hour, 30, 0, 0);
  vi.useFakeTimers();
  vi.setSystemTime(d);
}

describe("isDndActive", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("未开启免打扰 → 永不抑制", () => {
    expect(isDndActive({ dndEnabled: false, dndStart: "00:00", dndEnd: "23:59" })).toBe(false);
  });

  it("跨午夜区间（22:00–08:00）：夜里抑制、白天放行", () => {
    atHour(23);
    expect(isDndActive({ dndEnabled: true, dndStart: "22:00", dndEnd: "08:00" })).toBe(true);
    atHour(9);
    expect(isDndActive({ dndEnabled: true, dndStart: "22:00", dndEnd: "08:00" })).toBe(false);
  });

  it("同日区间（09:00–18:00）：区间内抑制、区间外放行", () => {
    atHour(10);
    expect(isDndActive({ dndEnabled: true, dndStart: "09:00", dndEnd: "18:00" })).toBe(true);
    atHour(19);
    expect(isDndActive({ dndEnabled: true, dndStart: "09:00", dndEnd: "18:00" })).toBe(false);
  });

  it("起止相同视为空区间，不抑制", () => {
    expect(isDndActive({ dndEnabled: true, dndStart: "08:00", dndEnd: "08:00" })).toBe(false);
  });
});

describe("投递判定", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("关掉邮件偏好即抑制邮件，其它通道不受影响", () => {
    expect(shouldSendEmail(pref({ emailNotify: false }))).toBe(false);
    expect(shouldSendPush(pref({ emailNotify: false }))).toBe(true);
  });

  it("关掉推送偏好即抑制推送，邮件仍放行", () => {
    expect(shouldSendPush(pref({ pushNotify: false }))).toBe(false);
    expect(shouldSendEmail(pref({ pushNotify: false }))).toBe(true);
  });

  it("DND 生效时邮件与推送同时抑制", () => {
    atHour(23);
    const inDnd = pref({ dndEnabled: true, dndStart: "22:00", dndEnd: "08:00" });
    expect(shouldSendEmail(inDnd)).toBe(false);
    expect(shouldSendPush(inDnd)).toBe(false);
  });
});

describe("getNotificationPreferences", () => {
  // 用 *Once + afterEach(mockReset)：若在同一 describe 里先用 mockResolvedValue
  // 再在下一条用例换成抛错实现，前一条留下的实现会与新实现叠加，
  // 产生一个不被任何 await 持有的已拒绝 promise，被 vitest 记为 unhandled
  // rejection 让下一条用例假红（本机最小复现：A→B 顺序失败、B 单独通过）。
  afterEach(() => upsertMock.mockReset());

  it("无记录时 upsert 落一行默认值并返回", async () => {
    upsertMock.mockResolvedValueOnce(pref() as never);
    const p = await getNotificationPreferences("u1");
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(p.emailNotify).toBe(true);
  });

  it("读取抛错时回退默认值（全开、不免打扰），保证通知不因偏好查询失败而丢失", async () => {
    upsertMock.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = await getNotificationPreferences("u2");
    // catch 分支确实被执行（而不是异常穿透）
    expect(spy, "读取失败应被捕获并记录").toHaveBeenCalled();
    expect(p).toEqual({
      emailNotify: true,
      pushNotify: true,
      dndEnabled: false,
      dndStart: "22:00",
      dndEnd: "08:00",
    });
    spy.mockRestore();
  });
});
