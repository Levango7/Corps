import { NextRequest, NextResponse } from "next/server";

/**
 * 内存固定窗口限流器（Spec 安全基线）。
 *
 * ⚠️ 单实例内存限流：计数存于进程内 Map，多实例 / Serverless 水平扩容部署时
 * 各实例独立计数，限流效果会被稀释 —— 届时需换 Redis 等共享存储（P2 待办）。
 *
 * 实现要点：
 *  - 固定窗口：每个 (bucket, key) 记录窗口起点与计数，窗口过期后重置。
 *  - 懒清理：不依赖定时器，读取/写入时顺带清理过期项。
 *  - 内存上限防护：key 总数超过 MAX_KEYS 时全量清扫过期项，
 *    防止攻击者伪造海量 IP 把 Map 撑爆（OOM 防线）。
 */

export interface RateLimitRule {
  /** 窗口时长（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大请求数 */
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** 被限流时距窗口重置的秒数（用于 Retry-After 头），ok 时为 0 */
  retryAfterSec: number;
}

interface WindowEntry {
  /** 当前固定窗口的起始时间戳（ms） */
  windowStart: number;
  /** 窗口内已累计的请求数 */
  count: number;
}

/** 内存上限防护阈值：超过此数量的 key 触发一次过期清扫 */
const MAX_KEYS = 10_000;

const store = new Map<string, WindowEntry>();

/**
 * 固定窗口计数。返回本次请求是否放行；被拒时附带 Retry-After 秒数。
 * 注意：Map 按 bucket + clientKey 组合为复合键，各端点配额互不影响。
 */
export function rateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();

  // 内存上限防护：key 过多时先清扫过期项（懒清理）
  if (store.size >= MAX_KEYS) {
    for (const [k, entry] of store) {
      if (now - entry.windowStart >= rule.windowMs) {
        store.delete(k);
      }
    }
    // 清扫后仍超上限（极端情况：全部未过期），丢弃最旧的一批以防 OOM
    if (store.size >= MAX_KEYS) {
      const excess = store.size - MAX_KEYS;
      let dropped = 0;
      for (const k of store.keys()) {
        if (dropped >= excess) break;
        store.delete(k);
        dropped++;
      }
    }
  }

  const entry = store.get(key);
  if (!entry || now - entry.windowStart >= rule.windowMs) {
    // 新窗口（或无记录）：重新计数并放行
    store.set(key, { windowStart: now, count: 1 });
    return { ok: true, retryAfterSec: 0 };
  }

  if (entry.count < rule.max) {
    entry.count++;
    return { ok: true, retryAfterSec: 0 };
  }

  // 超限：计算距窗口重置的秒数（向上取整，保证至少为 1）
  const retryAfterSec = Math.max(1, Math.ceil((entry.windowStart + rule.windowMs - now) / 1000));
  return { ok: false, retryAfterSec };
}

/** 从请求中提取客户端标识：x-forwarded-for 的第一个 IP；缺失则 "local" */
export function clientKey(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (!xff) return "local";
  const first = xff.split(",")[0]?.trim();
  return first || "local";
}

/**
 * 路由层便捷封装：未超限返回 null（放行）；
 * 超限直接返回 429 响应（含 Retry-After 头），调用方原样 return 即可。
 *
 * RATE_LIMIT_DISABLED === "1" 时整体禁用（集成测试环境：
 * 同源高频请求会被限流拦截，测试环境关闭）。
 */
export function checkRateLimit(
  req: NextRequest,
  bucket: string,
  rule: RateLimitRule,
): NextResponse | null {
  if (process.env.RATE_LIMIT_DISABLED === "1") {
    return null;
  }
  const result = rateLimit(`${bucket}:${clientKey(req)}`, rule);
  if (result.ok) return null;
  return NextResponse.json(
    { code: 429, message: "请求过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
  );
}