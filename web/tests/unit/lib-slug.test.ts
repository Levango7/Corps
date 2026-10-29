// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * slug 生成（lib/slug.ts）契约：清洗规则 + 唯一性重试。
 *
 * runWithAuthOp 走 provision 逃生口（RLS 加固模式下无上下文查询不可见行，
 * 预检必须显式声明 provision）——这里 mock 掉 auth 层，只验清洗与重试逻辑。
 */

let existingSlugs: Set<string>;
let queryCount: number;

vi.mock("@/lib/auth", () => ({
  runWithAuthOp: vi.fn(async (_op: string, fn: (tx: unknown) => unknown) =>
    fn({
      workspace: {
        findUnique: async ({ where }: { where: { slug: string } }) => {
          queryCount += 1;
          return existingSlugs.has(where.slug) ? { id: "collision" } : null;
        },
      },
    }),
  ),
}));

import { generateSlug } from "@/lib/slug";

beforeEach(() => {
  existingSlugs = new Set<string>();
  queryCount = 0;
});

describe("generateSlug —— 清洗规则", () => {
  it("小写化 + 空白转连字符", async () => {
    expect(await generateSlug("Acme Corp")).toBe("acme-corp");
    expect(await generateSlug("  A   B  ")).toBe("a-b");
  });

  it("剥离非字母数字字符（非拉丁字符清洗为空 → 走 ws- 回退）", async () => {
    expect(await generateSlug("Acme! Corp #1")).toBe("acme-corp-1");
    expect(await generateSlug("株式会社")).toMatch(/^ws-/);
  });

  it("连续连字符合并、首尾连字符去除", async () => {
    expect(await generateSlug("--a---b--")).toBe("a-b");
    expect(await generateSlug("-abc-")).toBe("abc");
  });

  it("截断到 40 字符", async () => {
    const slug = await generateSlug("a".repeat(60));
    expect(slug).toHaveLength(40);
  });

  it("纯符号名清洗为空 → 回退 ws- 前缀随机 slug（永不为空字符串）", async () => {
    const slug = await generateSlug("!!!@@@");
    expect(slug).toMatch(/^ws-/);
    expect(slug.length).toBeGreaterThan(3);
    // 名字非法时两次生成不应相同（随机）
    expect(await generateSlug("!!!@@@")).not.toBe(slug);
  });
});

describe("generateSlug —— 唯一性重试", () => {
  it("slug 不存在 → 直接返回（仅 1 次查询）", async () => {
    const slug = await generateSlug("fresh-name");
    expect(slug).toBe("fresh-name");
    expect(queryCount).toBe(1);
  });

  it("slug 已存在 → 追加随机后缀直到可用（尝试新的 slug）", async () => {
    existingSlugs.add("taken");
    const slug = await generateSlug("taken");
    expect(slug).not.toBe("taken");
    expect(slug.startsWith("taken-")).toBe(true);
    expect(slug).toMatch(/^taken-[a-z0-9]{4}$/);
  });

  it("前 4 次都碰撞、第 5 次可用 → 第 5 次查询放行（共查 5 次）", async () => {
    let probeCalls = 0;
    existingSlugs = {
      has: (s: string) => {
        probeCalls += 1;
        // base 本身 + 前 3 次带后缀都算碰撞，第 5 次查询放行
        return s === "dup" || (probeCalls <= 4 && s.startsWith("dup-"));
      },
    } as unknown as Set<string>;
    const slug = await generateSlug("dup");
    expect(slug).toMatch(/^dup-[a-z0-9]{4}$/);
    expect(existingSlugs.has(slug)).toBe(false);
    expect(queryCount).toBe(5);
  });

  it("5 次重试全碰撞 → 返回最后一个带后缀 slug（交由 DB unique 约束兜底 P2002）", async () => {
    existingSlugs = { has: () => true } as unknown as Set<string>;
    const slug = await generateSlug("always-taken");
    expect(slug.startsWith("always-taken")).toBe(true);
    expect(slug).not.toBe("always-taken");
    expect(queryCount).toBe(5);
  });

  it("清洗后碰撞：base 清洗只发生一次，重试基于同一 base", async () => {
    existingSlugs.add("acme-corp");
    const slug = await generateSlug("Acme Corp");
    expect(slug.startsWith("acme-corp-")).toBe(true);
  });

  it("预检查询经 provision 逃生口（op 参数透传）", async () => {
    const { runWithAuthOp } = await import("@/lib/auth");
    await generateSlug("x");
    expect(runWithAuthOp).toHaveBeenCalledWith("provision", expect.any(Function));
  });
});
