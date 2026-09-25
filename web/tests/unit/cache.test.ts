import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * cache.ts 单元测试
 *
 * 覆盖 web/lib/cache.ts：
 *  - cachedQuery：包装 next/cache 的 unstable_cache，透传 fn/keyParts/revalidate，
 *    并把 keyParts 同时用作缓存 tags（支持 revalidateTag 批量失效）
 *  - memoQuery：react 级别 cache（同一请求内去重），测试中 mock 为 identity
 *
 * Mock 策略：
 *  - next/cache 的 unstable_cache → vi.fn，可断言调用参数；默认实现返回透传 fn 的 vi.fn
 *  - react 的 cache → identity，使 memoQuery(fn) === fn，便于断言透传
 */

const { unstableCacheMock } = vi.hoisted(() => ({
  unstableCacheMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: unstableCacheMock,
}));

vi.mock("react", () => ({
  cache: <T>(fn: T) => fn,
}));

import { cachedQuery, memoQuery } from "@/lib/cache";

beforeEach(() => {
  unstableCacheMock.mockReset();
  // 默认实现：返回一个透传调用的 vi.fn，使 cached() 能执行原 fn 并可断言调用次数
  unstableCacheMock.mockImplementation((fn: () => Promise<unknown>) => vi.fn(fn));
});

describe("cachedQuery", () => {
  it("返回一个可调用的函数", async () => {
    const fn = vi.fn(() => Promise.resolve(42));
    const cached = cachedQuery(fn, ["test-key"], 60);
    expect(typeof cached).toBe("function");
    const result = await cached();
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("透传 fn、keyParts、revalidate 到 unstable_cache", () => {
    const fn = vi.fn(() => Promise.resolve("data"));
    cachedQuery(fn, ["key1", "key2"], 30);

    expect(unstableCacheMock).toHaveBeenCalledTimes(1);
    const [argFn, argKeyParts, argOpts] = unstableCacheMock.mock.calls[0];
    expect(argFn).toBe(fn);
    expect(argKeyParts).toEqual(["key1", "key2"]);
    expect(argOpts).toEqual({ revalidate: 30, tags: ["key1", "key2"] });
  });

  it("revalidateSeconds 默认为 60", () => {
    const fn = vi.fn(() => Promise.resolve(null));
    cachedQuery(fn, ["default-key"]);

    expect(unstableCacheMock).toHaveBeenCalledTimes(1);
    const argOpts = unstableCacheMock.mock.calls[0][2] as { revalidate: number };
    expect(argOpts.revalidate).toBe(60);
  });

  it("tags 等于 keyParts（支持 revalidateTag 批量失效）", () => {
    const fn = vi.fn(() => Promise.resolve(null));
    cachedQuery(fn, ["tasks:ws-1", "page:2"], 60);

    const argOpts = unstableCacheMock.mock.calls[0][2] as { tags: string[] };
    expect(argOpts.tags).toEqual(["tasks:ws-1", "page:2"]);
  });

  it("接受不同的 keyParts 和 revalidate 值", () => {
    const fn = vi.fn(() => Promise.resolve("data"));
    const cached = cachedQuery(fn, ["key1", "key2"], 30);
    expect(cached).toBeDefined();
    expect(typeof cached).toBe("function");
  });

  it("不同 keyParts 产生独立缓存调用", () => {
    const fnA = vi.fn(() => Promise.resolve("a"));
    const fnB = vi.fn(() => Promise.resolve("b"));
    cachedQuery(fnA, ["resource-a"], 60);
    cachedQuery(fnB, ["resource-b"], 60);

    expect(unstableCacheMock).toHaveBeenCalledTimes(2);
    const optsA = unstableCacheMock.mock.calls[0][2] as { tags: string[] };
    const optsB = unstableCacheMock.mock.calls[1][2] as { tags: string[] };
    expect(optsA.tags).toEqual(["resource-a"]);
    expect(optsB.tags).toEqual(["resource-b"]);
  });
});

describe("memoQuery", () => {
  it("透传函数（react cache 在测试中为 identity）", () => {
    const fn = vi.fn((x: number) => x * 2);
    const memoized = memoQuery(fn);
    // mock react cache 为 identity，故 memoized === fn
    expect(memoized).toBe(fn);
    expect(memoized(5)).toBe(10);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("多次调用同一 memoized 函数正常执行", () => {
    const fn = vi.fn((x: number) => x + 1);
    const memoized = memoQuery(fn);
    expect(memoized(1)).toBe(2);
    expect(memoized(2)).toBe(3);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("保留原函数的类型与行为", () => {
    const concat = (a: string, b: string) => `${a}-${b}`;
    const memoized = memoQuery(concat);
    expect(memoized("foo", "bar")).toBe("foo-bar");
  });
});
