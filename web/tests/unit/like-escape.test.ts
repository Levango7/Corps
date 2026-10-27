import { describe, it, expect } from "vitest";
import { escapeLikeOperand, likeContainsPattern } from "@/lib/like-escape";

/**
 * escapeLikeOperand / likeContainsPattern 单测。
 *
 * 这两个函数的存在理由：/api/v1/im/search 走 $queryRawUnsafe（tsvector 分支无法用
 * Prisma 表达），所以 Prisma `contains` 自带的 LIKE 元字符转义在这里没有，必须自己转。
 * 集成测试 web/tests/integration/im-search.test.ts 从行为端钉住「% 不当通配符」，
 * 本文件从纯函数端钉住三个元字符各自的转义形状。
 */

describe("escapeLikeOperand", () => {
  it("三个 LIKE 元字符各自前置反斜杠", () => {
    expect(escapeLikeOperand("100%")).toBe("100\\%");
    expect(escapeLikeOperand("a_b")).toBe("a\\_b");
    expect(escapeLikeOperand("C:\\temp")).toBe("C:\\\\temp");
  });

  it("输入 \\% 时反斜杠先转义，得到 \\\\%（不是只转 % 一次的错误形状）", () => {
    // 只 replace("%"→"\\"+"%") 的实现会把 `\%` 变成 `\\%`——后者在 SQL 里是
    // 「转义过的反斜杠 + 通配符」，用户字面输入的 % 又变回通配符。
    expect(escapeLikeOperand("\\%")).toBe("\\\\\\%");
    expect(escapeLikeOperand("\\%")).not.toBe("\\\\%");
  });

  it("普通中英文、数字与标点原样通过（转义不该碰非元字符）", () => {
    expect(escapeLikeOperand("连接池需要扩容")).toBe("连接池需要扩容");
    expect(escapeLikeOperand("RollbackRunbook2026")).toBe("RollbackRunbook2026");
    expect(escapeLikeOperand("预算 2026-Q3 已确认，请核对。")).toBe("预算 2026-Q3 已确认，请核对。");
  });

  it("空串返回空串（q 的 min(1) 由 zod 拦，这里不造额外默认值）", () => {
    expect(escapeLikeOperand("")).toBe("");
  });
});

describe("likeContainsPattern", () => {
  it("前后各加一个通配符，中间保持转义", () => {
    expect(likeContainsPattern("100%")).toBe("%100\\%%");
    expect(likeContainsPattern("关键词")).toBe("%关键词%");
  });

  it("整体形状恒为 %<escapeLikeOperand(原串)>%", () => {
    const raw = "a%b_c\\d";
    const pattern = likeContainsPattern(raw);
    expect(pattern.startsWith("%")).toBe(true);
    expect(pattern.endsWith("%")).toBe(true);
    expect(pattern.slice(1, -1)).toBe(escapeLikeOperand(raw));
  });
});
