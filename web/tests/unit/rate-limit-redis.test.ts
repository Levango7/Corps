import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Redis 共享计数模式单元测试（vi.mock("ioredis")）
 *
 * 覆盖 web/lib/rate-limit.ts 在 REDIS_URL 配置时的行为：
 *  - INCR 返回 1（新窗口）：放行且 PEXPIRE 被调用设置窗口过期
 *  - INCR 返回超过 max 的值：429 拒绝，retryAfterSec 来自 PTTL 向上取整
 *  - Redis 命令抛错：一次性 console.error 后降级到内存实现，不向上抛异常
 *  - isRedisActive() 在正常 / 降级状态下的返回值
 *
 * 注意：ioredis 默认导出被 mock 为 class，实例方法均为 vi.fn()；
 * 模块级单例（client/degraded 标记）通过 vi.resetModules() + 动态 import 隔离。
 */

// vi.mock 工厂会被提升，需用 vi.hoisted 创建可在工厂内引用的 mock 函数
const mockIncr = vi.hoisted(() => vi.fn());
const mockPexpire = vi.hoisted(() => vi.fn());
const mockPttl = vi.hoisted(() => vi.fn());
const mockOn = vi.hoisted(() => vi.fn());

// ioredis 默认导出为 class；实例方法用 vi.fn() 注入
vi.mock("ioredis", () => ({
  default: class MockRedis {
    incr = mockIncr;
    pexpire = mockPexpire;
    pttl = mockPttl;
    on = mockOn;
  },
}));

const RULE = { windowMs: 60_000, max: 3 };

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

function makeReq(ip: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/auth/login", {
    headers: { "x-forwarded-for": ip },
  });
}

/** 每个用例重新加载被测模块，隔离模块级 client 单例与 degraded 标记 */
async function loadModule() {
  return await import("@/lib/rate-limit");
}

describe("rate-limit - REDIS_URL 多实例共享计数", () => {
  beforeEach(() => {
    vi.resetModules();
    mockIncr.mockReset();
    mockPexpire.mockReset();
    mockPttl.mockReset();
    mockOn.mockReset();
    // 默认按 Redis 模式加载；个别用例可覆盖
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterEach(() => {
    // 恢复环境变量，避免泄漏到其他测试文件
    if (ORIGINAL_REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    }
  });

  it("INCR 返回 1（新窗口）：ok 放行且 PEXPIRE 设置窗口时长", async () => {
    mockIncr.mockResolvedValue(1);
    const mod = await loadModule();

    const res = await mod.checkRateLimit(makeReq("1.1.1.1"), "login", RULE);

    expect(res).toBeNull(); // 放行
    expect(mockIncr).toHaveBeenCalledWith("login:1.1.1.1");
    expect(mockPexpire).toHaveBeenCalledTimes(1);
    expect(mockPexpire).toHaveBeenCalledWith("login:1.1.1.1", RULE.windowMs);
    expect(mod.isRedisActive()).toBe(true);
  });

  it("INCR 未超限（1 < count <= max）时同样放行且不再 PEXPIRE", async () => {
    mockIncr.mockResolvedValue(RULE.max); // 恰好达到 max 但未超过 → 放行
    const mod = await loadModule();

    const res = await mod.checkRateLimit(makeReq("2.2.2.2"), "login", RULE);

    expect(res).toBeNull();
    expect(mockPexpire).not.toHaveBeenCalled();
  });

  it("INCR 返回超过 max 的值：拒绝且 retryAfterSec 来自 PTTL 向上取整秒", async () => {
    mockIncr.mockResolvedValue(RULE.max + 1);
    mockPttl.mockResolvedValue(45_678); // 45.678s → ceil = 46s
    const mod = await loadModule();

    const res = await mod.checkRateLimit(makeReq("3.3.3.3"), "login", RULE);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(Number(res!.headers.get("retry-after"))).toBe(46);
    const body = (await res!.json()) as { code: number };
    expect(body.code).toBe(429);
    expect(mockPttl).toHaveBeenCalledWith("login:3.3.3.3");
  });

  it("PTTL 返回非正值（边界）时回退到整个窗口时长作为 Retry-After", async () => {
    mockIncr.mockResolvedValue(RULE.max + 1);
    mockPttl.mockResolvedValue(-2); // key 已不存在的边界情况
    const mod = await loadModule();

    const res = await mod.checkRateLimit(makeReq("4.4.4.4"), "login", RULE);

    expect(res).not.toBeNull();
    expect(Number(res!.headers.get("retry-after"))).toBe(60);
  });

  it("Redis 抛错时降级为内存结果且不抛异常（console.error 仅一次）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockIncr.mockRejectedValue(new Error("ECONNREFUSED"));
      const mod = await loadModule();
      const req = makeReq("5.5.5.5");

      // 第一次请求触发降级：不应抛异常，且降级后由内存实现计数放行
      await expect(mod.checkRateLimit(req, "login", RULE)).resolves.toBeNull();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(mod.isRedisActive()).toBe(false);

      // 降级后的后续请求走内存 Map 计数：换一个新 key 验证完整窗口行为
      // （首次失败请求已占用 "login:5.5.5.5" 的 1 次配额）
      for (let i = 0; i < RULE.max; i++) {
        await expect(
          mod.checkRateLimit(makeReq("6.6.6.6"), "login", RULE),
        ).resolves.toBeNull();
      }
      const blocked = await mod.checkRateLimit(makeReq("6.6.6.6"), "login", RULE);
      expect(blocked).not.toBeNull();
      expect(blocked!.status).toBe(429);
      // 降级只报一次错：后续请求不再刷日志
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("未配置 REDIS_URL 时直接走内存实现（不创建 Redis 客户端）", async () => {
    delete process.env.REDIS_URL;
    const mod = await loadModule();

    const res = await mod.checkRateLimit(makeReq("6.6.6.6"), "login", RULE);

    expect(res).toBeNull();
    expect(mockIncr).not.toHaveBeenCalled();
    expect(mod.isRedisActive()).toBe(false);
  });
});