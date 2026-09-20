import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isLocked,
  recordFailure,
  clearFailures,
  rateLimitKey,
} from "@/lib/share-rate-limit";

describe("share-rate-limit", () => {
  beforeEach(() => {
    // 每个测试前清除所有失败记录
    // 由于 failureMap 是模块级私有 Map，通过 clearFailures 清除已知 key
    // 但更可靠的方式是 vi.resetModules + 重新 import
  });

  describe("rateLimitKey", () => {
    it("构造正确的 key 格式", () => {
      expect(rateLimitKey("document", "doc-1", "127.0.0.1")).toBe(
        "document:doc-1:127.0.0.1",
      );
    });

    it("task 类型也正确", () => {
      expect(rateLimitKey("task", "task-1", "10.0.0.1")).toBe(
        "task:task-1:10.0.0.1",
      );
    });
  });

  describe("isLocked / recordFailure / clearFailures", () => {
    it("初始状态未锁定", () => {
      const key = rateLimitKey("document", "doc-test-1", "1.1.1.1");
      expect(isLocked(key)).toBe(false);
    });

    it("失败 1-2 次未锁定", () => {
      const key = rateLimitKey("document", "doc-test-2", "2.2.2.2");
      recordFailure(key);
      expect(isLocked(key)).toBe(false);
      recordFailure(key);
      expect(isLocked(key)).toBe(false);
    });

    it("失败 3 次后锁定", () => {
      const key = rateLimitKey("document", "doc-test-3", "3.3.3.3");
      recordFailure(key);
      recordFailure(key);
      recordFailure(key);
      expect(isLocked(key)).toBe(true);
    });

    it("clearFailures 后解锁", () => {
      const key = rateLimitKey("document", "doc-test-4", "4.4.4.4");
      recordFailure(key);
      recordFailure(key);
      recordFailure(key);
      expect(isLocked(key)).toBe(true);
      clearFailures(key);
      expect(isLocked(key)).toBe(false);
    });

    it("不同 IP 的失败独立计数", () => {
      const keyA = rateLimitKey("document", "doc-test-5", "5.5.5.5");
      const keyB = rateLimitKey("document", "doc-test-5", "6.6.6.6");
      recordFailure(keyA);
      recordFailure(keyA);
      recordFailure(keyA);
      expect(isLocked(keyA)).toBe(true);
      expect(isLocked(keyB)).toBe(false);
    });

    it("不同实体的失败独立计数", () => {
      const keyA = rateLimitKey("document", "doc-A", "7.7.7.7");
      const keyB = rateLimitKey("document", "doc-B", "7.7.7.7");
      recordFailure(keyA);
      recordFailure(keyA);
      recordFailure(keyA);
      expect(isLocked(keyA)).toBe(true);
      expect(isLocked(keyB)).toBe(false);
    });
  });
});