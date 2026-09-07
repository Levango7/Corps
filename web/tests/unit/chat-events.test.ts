import { describe, it, expect } from "vitest";
import { tryAcquireSseSlot, releaseSseSlot } from "@/lib/chat-events";

/**
 * SSE 单用户并发连接额度单元测试（审计遗留收口）
 *
 * 覆盖 web/lib/chat-events.ts 的 tryAcquireSseSlot / releaseSseSlot：
 *  - 上限内可连续获取（多端登录场景：PC/手机/平板 + 余量）
 *  - 达到上限（5）后拒绝，其他用户不受影响
 *  - 释放后恢复可用（release 与 acquire 配对）
 *  - 释放到 0 后 Map 条目清除（不泄漏 key）
 *  - 未 acquire 过的用户 release 是安全的 no-op（不会出现负数）
 */

describe("tryAcquireSseSlot / releaseSseSlot - 单用户并发上限", () => {
  it("上限内（5）可连续获取", () => {
    const user = `u-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(tryAcquireSseSlot(user)).toBe(true);
    }
    // 第 6 个连接被拒
    expect(tryAcquireSseSlot(user)).toBe(false);
  });

  it("一个用户达上限不影响其他用户", () => {
    const a = `u-a-${Math.random()}`;
    const b = `u-b-${Math.random()}`;
    for (let i = 0; i < 5; i++) tryAcquireSseSlot(a);
    expect(tryAcquireSseSlot(a)).toBe(false);
    expect(tryAcquireSseSlot(b)).toBe(true);
  });

  it("释放后恢复可用（断开连接释放额度）", () => {
    const user = `u-${Math.random()}`;
    for (let i = 0; i < 5; i++) tryAcquireSseSlot(user);
    expect(tryAcquireSseSlot(user)).toBe(false);
    releaseSseSlot(user);
    expect(tryAcquireSseSlot(user)).toBe(true);
  });

  it("重复释放是安全的（cleanup 幂等场景）", () => {
    const user = `u-${Math.random()}`;
    tryAcquireSseSlot(user);
    releaseSseSlot(user);
    releaseSseSlot(user); // 重复释放不得进入负数
    expect(tryAcquireSseSlot(user)).toBe(true);
    expect(tryAcquireSseSlot(user)).toBe(true); // 前一次重复释放没扣减额度
  });

  it("未获取过的用户 release 是 no-op", () => {
    const user = `u-never-${Math.random()}`;
    expect(() => releaseSseSlot(user)).not.toThrow();
    expect(tryAcquireSseSlot(user)).toBe(true);
  });
});
