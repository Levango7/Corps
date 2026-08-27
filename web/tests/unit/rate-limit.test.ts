import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  rateLimit,
  clientKey,
  isPrivateIp,
  checkRateLimit,
  type RateLimitRule,
} from "@/lib/rate-limit";

/**
 * 内存限流器单元测试
 *
 * 覆盖 web/lib/rate-limit.ts 的 rateLimit / clientKey / checkRateLimit：
 *  - 未超限放行（ok: true）
 *  - 达到 max 后拒绝且 retryAfterSec > 0
 *  - 窗口过期后恢复可用（fake timers 推进时间）
 *  - 不同 key（不同 bucket 或不同 IP）互不影响
 *  - RATE_LIMIT_DISABLED=1 时 checkRateLimit 返回 null（整体禁用）
 *
 * rateLimit 是纯函数可直接测；checkRateLimit 通过构造 NextRequest 测试。
 */

const RULE: RateLimitRule = { windowMs: 60_000, max: 3 };

describe("rateLimit - 固定窗口计数", () => {
  it("未超限时返回 ok:true", () => {
    // Arrange：每个用例使用唯一 key，避免测试间共享窗口状态
    const key = `test-under-${Math.random()}`;

    // Act & Assert：max = 3，前 3 次都应放行
    for (let i = 0; i < RULE.max; i++) {
      const result = rateLimit(key, RULE);
      expect(result.ok).toBe(true);
      expect(result.retryAfterSec).toBe(0);
    }
  });

  it("达到 max 后返回 ok:false 且 retryAfterSec > 0", () => {
    const key = `test-over-${Math.random()}`;

    // Act：耗尽配额后再请求一次
    for (let i = 0; i < RULE.max; i++) {
      rateLimit(key, RULE);
    }
    const blocked = rateLimit(key, RULE);

    // Assert
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60); // 不超过一个窗口时长
  });

  it("推进时间超过窗口后恢复可用（固定窗口重置）", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      const key = "test-window-reset";

      // 耗尽配额 → 拒绝
      for (let i = 0; i < RULE.max; i++) {
        expect(rateLimit(key, RULE).ok).toBe(true);
      }
      expect(rateLimit(key, RULE).ok).toBe(false);

      // 推进到窗口边界之后 → 新窗口重新计数
      vi.advanceTimersByTime(RULE.windowMs + 1_000);
      const result = rateLimit(key, RULE);
      expect(result.ok).toBe(true);
      expect(result.retryAfterSec).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("不同 key 互不影响（bucket 隔离）", () => {
    const keyA = `test-iso-a-${Math.random()}`;
    const keyB = `test-iso-b-${Math.random()}`;

    // A 耗尽配额
    for (let i = 0; i < RULE.max; i++) {
      rateLimit(keyA, RULE);
    }
    expect(rateLimit(keyA, RULE).ok).toBe(false);

    // B 未受影响，仍然放行
    expect(rateLimit(keyB, RULE).ok).toBe(true);
  });

  it("同一 bucket 下不同客户端 key 互不影响", () => {
    // 模拟 checkRateLimit 的复合键："login:<ip>"
    const ip1 = `login:10.0.0.${Math.floor(Math.random() * 250) + 1}`;
    const ip2 = `login:10.0.1.${Math.floor(Math.random() * 250) + 1}`;

    for (let i = 0; i < RULE.max; i++) {
      rateLimit(ip1, RULE);
    }
    expect(rateLimit(ip1, RULE).ok).toBe(false);
    expect(rateLimit(ip2, RULE).ok).toBe(true);
  });
});

describe("clientKey - 可信对端客户端标识提取（TC-RATE-02/03）", () => {
  /**
   * 构造带可控 socket 地址（req.ip）的请求对象。
   * NextRequest.ip 仅在 Next.js 适配层注入，无法经构造函数设置，
   * 而 clientKey 只依赖 req.ip 与 req.headers，故用最小桩对象即可精确测试。
   */
  function makeReq(opts: { ip?: string; headers?: Record<string, string> }): NextRequest {
    return {
      ip: opts.ip,
      headers: new Headers(opts.headers ?? {}),
    } as unknown as NextRequest;
  }

  it("直连公网对端：只用 socket 地址，忽略伪造的 x-forwarded-for / x-real-ip（TC-RATE-02）", () => {
    const req = makeReq({
      ip: "203.0.113.7",
      headers: {
        "x-forwarded-for": "1.2.3.4, 5.6.7.8", // 攻击者伪造
        "x-real-ip": "9.9.9.9", // 攻击者伪造
      },
    });
    expect(clientKey(req)).toBe("203.0.113.7");
  });

  it("私网对端（反代）：取 XFF 尾段而非首段（TC-RATE-03）", () => {
    const req = makeReq({
      ip: "10.0.0.1", // 反代/容器网桥对端
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" }, // 首段伪造，尾段为反代追加的真实 IP
    });
    expect(clientKey(req)).toBe("203.0.113.9");
  });

  it("私网对端且 XFF 缺失：回退 x-real-ip（TC-RATE-03 兜底顺序）", () => {
    const req = makeReq({
      ip: "192.168.1.10",
      headers: { "x-real-ip": " 198.51.100.23 " },
    });
    expect(clientKey(req)).toBe("198.51.100.23");
  });

  it("私网对端且全部代理头缺失：兜底 socket 地址", () => {
    const req = makeReq({ ip: "127.0.0.1" });
    expect(clientKey(req)).toBe("127.0.0.1");
  });

  it("无 socket 地址且无代理头：返回 local", () => {
    const req = new NextRequest("http://localhost/api/v1/events");
    expect(clientKey(req)).toBe("local");
  });

  it("IPv4-mapped IPv6：::ffff:公网 视为直连，::ffff:私网 视为代理对端", () => {
    const direct = makeReq({
      ip: "::ffff:203.0.113.7",
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(clientKey(direct)).toBe("::ffff:203.0.113.7");

    const proxied = makeReq({
      ip: "::ffff:127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.9" },
    });
    expect(clientKey(proxied)).toBe("198.51.100.9");
  });

  it("XFF 单段即客户端 IP（无多级代理时尾段==首段）", () => {
    const req = makeReq({
      ip: "172.16.0.5",
      headers: { "x-forwarded-for": "203.0.113.55" },
    });
    expect(clientKey(req)).toBe("203.0.113.55");
  });
});

describe("isPrivateIp - 私网/环回地址判定", () => {
  it("私网与环回地址返回 true", () => {
    const privates = [
      "127.0.0.1",
      "127.8.9.10",
      "10.0.0.1",
      "192.168.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.1.1",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:10.1.2.3",
      "::ffff:172.16.0.1",
      "fd12:3456::1",
      "fe80::1",
    ];
    for (const ip of privates) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("公网地址返回 false（含 172/12 数值边界）", () => {
    const publics = [
      "8.8.8.8",
      "203.0.113.7",
      "172.15.255.255", // 172.16/12 下边界之外
      "172.32.0.1", // 172.16/12 上边界之外
      "192.167.0.1",
      "169.255.0.1",
      "9.9.9.9",
      "::ffff:8.8.8.8",
      "2001:db8::1",
    ];
    for (const ip of publics) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});

describe("checkRateLimit - 路由层封装", () => {
  const ORIGINAL_DISABLED = process.env.RATE_LIMIT_DISABLED;

  afterEach(() => {
    // 恢复环境变量，避免泄漏到其他测试文件
    if (ORIGINAL_DISABLED === undefined) {
      delete process.env.RATE_LIMIT_DISABLED;
    } else {
      process.env.RATE_LIMIT_DISABLED = ORIGINAL_DISABLED;
    }
    vi.useRealTimers();
  });

  function makeReq(ip: string): NextRequest {
    return new NextRequest("http://localhost/api/v1/auth/login", {
      headers: { "x-forwarded-for": ip },
    });
  }

  it("RATE_LIMIT_DISABLED=1 时直接返回 null（禁用限流）", async () => {
    process.env.RATE_LIMIT_DISABLED = "1";
    const req = makeReq("9.9.9.9");
    // 即使远超 max，也必须放行（返回 null）
    for (let i = 0; i < RULE.max + 5; i++) {
      await expect(checkRateLimit(req, "login-disabled-test", RULE)).resolves.toBeNull();
    }
  });

  it("未超限时返回 null（放行）", async () => {
    delete process.env.RATE_LIMIT_DISABLED;
    const req = makeReq(`8.8.8.${Math.floor(Math.random() * 200) + 1}`);
    await expect(checkRateLimit(req, "login-check-ok", RULE)).resolves.toBeNull();
  });

  it("超限时返回 429 响应并带 Retry-After 头与中文 message", async () => {
    delete process.env.RATE_LIMIT_DISABLED;
    const req = makeReq("7.7.7.7");
    const bucket = "login-check-429";

    // 耗尽配额
    for (let i = 0; i < RULE.max; i++) {
      await expect(checkRateLimit(req, bucket, RULE)).resolves.toBeNull();
    }

    // 第 max+1 次：429
    const res = await checkRateLimit(req, bucket, RULE);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("retry-after")).toBeTruthy();
    expect(Number(res!.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await res!.json()) as { code: number; message: string };
    expect(body.code).toBe(429);
    expect(body.message).toBe("请求过于频繁，请稍后再试");
  });
});
