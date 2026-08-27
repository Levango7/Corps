import { NextRequest, NextResponse } from "next/server";
import type Redis from "ioredis";

/**
 * 限流器（Spec 安全基线）：固定窗口计数，两种存储模式按环境自动选择。
 *
 * 模式一（默认）—— 单实例内存限流：
 *   未配置 REDIS_URL 时，计数存于进程内 Map。多实例 / Serverless 水平扩容
 *   部署时各实例独立计数，限流效果会被稀释。
 *
 * 模式二 —— 多实例 REDIS_URL 共享计数：
 *   配置 REDIS_URL 后走 Redis 固定窗口原子操作（INCR + PEXPIRE + PTTL），
 *   所有实例共享同一份计数，水平扩容下限流配额依然精确。客户端懒加载单例，
 *   仅在首次请求时建立连接，未使用 Redis 的部署零开销。
 *
 * 降级策略：
 *   Redis 连接/命令失败时，进程内标记 degraded 并 console.error 一次
 *   （避免每个请求刷错误日志），之后自动降级为模式一的内存实现继续放行/拒绝，
 *   保证 Redis 故障不会拖垮业务接口；恢复需重启进程或重新部署。
 *   可通过 isRedisActive() 判断当前是否处于 Redis 正常模式（测试与诊断用）。
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

const memoryStore = new Map<string, WindowEntry>();

// ─── Redis 懒加载单例 ─────────────────────────────────────────────────────────

let client: Redis | null = null;
/** 进程内降级标记：true 后所有请求直接走内存实现，不再尝试 Redis、不再刷日志 */
let degraded = false;

async function getRedisClient(): Promise<Redis | null> {
  if (degraded || !process.env.REDIS_URL) return null;
  if (client) return client;
  try {
    // 动态 import 懒加载：未配置 REDIS_URL 的部署不产生任何连接开销
    const mod = await import("ioredis");
    const instance: Redis = new mod.default(process.env.REDIS_URL as string, {
      // 命令失败快速返回错误交给上层降级，不做长重试阻塞请求
      maxRetriesPerRequest: 1,
    });
    // 连接类错误（ECONNREFUSED 等）：标记降级并只打印一次
    instance.on("error", (err: Error) => {
      if (!degraded) {
        degraded = true;
        console.error("[rate-limit] Redis 连接异常，降级为进程内内存限流:", err.message);
      }
    });
    client = instance;
    return client;
  } catch (error) {
    // 加载/构造失败同样降级，只报一次
    degraded = true;
    console.error("[rate-limit] Redis 客户端初始化失败，降级为进程内内存限流:", error);
    return null;
  }
}

/** 当前是否处于 Redis 共享计数模式（已配置且未降级）；供测试与诊断使用 */
export function isRedisActive(): boolean {
  return !degraded && !!process.env.REDIS_URL && client !== null;
}

// ─── 抽象 store 层 ──────────────────────────────────────────────────────────────

/**
 * 固定窗口计数（store 抽象层）：内部按 REDIS_URL 自动选择 Redis 或内存实现。
 * 返回本次请求是否放行；被拒时附带 Retry-After 秒数。
 * 注意：key 按 bucket + clientKey 组合为复合键，各端点配额互不影响。
 */
async function hitStore(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  const redis = await getRedisClient();
  if (!redis) return hitMemoryStore(key, max, windowMs);

  try {
    // 固定窗口原子操作：INCR 计数，首次进入窗口时设置过期时间
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, windowMs);
    }
    if (count > max) {
      // 超限：PTTL 取剩余毫秒，向上取整为秒（至少 1 秒）
      let remainingMs = windowMs;
      try {
        const pttl = await redis.pttl(key);
        // PTTL 可能返回 -1/-2（无过期/不存在等边界），回退到整个窗口时长
        if (pttl > 0) remainingMs = pttl;
      } catch {
        /* PTTL 失败不影响拒绝判定，仅影响 Retry-After 精度 */
      }
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }
    return { ok: true, retryAfterSec: 0 };
  } catch (error) {
    // 命令级失败（网络抖动等）：一次性报错并降级到内存实现，绝不向上抛异常
    if (!degraded) {
      degraded = true;
      console.error("[rate-limit] Redis 命令执行失败，降级为进程内内存限流:", error);
    }
    return hitMemoryStore(key, max, windowMs);
  }
}

/** 内存固定窗口实现（模式一，也是 Redis 故障时的降级路径） */
function hitMemoryStore(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // 内存上限防护：key 过多时先清扫过期项（懒清理）
  if (memoryStore.size >= MAX_KEYS) {
    for (const [k, entry] of memoryStore) {
      if (now - entry.windowStart >= windowMs) {
        memoryStore.delete(k);
      }
    }
    // 清扫后仍超上限（极端情况：全部未过期），丢弃最旧的一批以防 OOM
    if (memoryStore.size >= MAX_KEYS) {
      const excess = memoryStore.size - MAX_KEYS;
      let dropped = 0;
      for (const k of memoryStore.keys()) {
        if (dropped >= excess) break;
        memoryStore.delete(k);
        dropped++;
      }
    }
  }

  const entry = memoryStore.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    // 新窗口（或无记录）：重新计数并放行
    memoryStore.set(key, { windowStart: now, count: 1 });
    return { ok: true, retryAfterSec: 0 };
  }

  if (entry.count < max) {
    entry.count++;
    return { ok: true, retryAfterSec: 0 };
  }

  // 超限：计算距窗口重置的秒数（向上取整，保证至少为 1）
  const retryAfterSec = Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000));
  return { ok: false, retryAfterSec };
}

/**
 * 同步内存版固定窗口计数（保持既有导出 API 不变）：
 * 直接操作内存 store，等价于绕过 store 抽象层的纯内存调用。
 */
export function rateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  return hitMemoryStore(key, rule.max, rule.windowMs);
}

/** 解析点分十进制 IPv4；非法格式返回 null（数值化解析，避免正则壳误判） */
function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return octets.some((o) => Number.isNaN(o) || o > 255)
    ? null
    : (octets as [number, number, number, number]);
}

/**
 * 私网/环回/链路本地地址判定（含 IPv4-mapped IPv6 形式，如 ::ffff:127.0.0.1）。
 * socket 对端为此类地址 ⇒ 流量来自反向代理/容器网桥/本机回环，应采信代理头；
 * 对端为公网地址 ⇒ 客户端直连，代理头不可信。
 */
export function isPrivateIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  // IPv6 环回
  if (normalized === "::1") return true;
  // IPv6 ULA（fc00::/7，实际分配以 fd 开头）与链路本地（fe80::/10）
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return true;
  // 剥离 IPv4-mapped IPv6 前缀后按 IPv4 判断
  const v4 = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  const octets = parseIpv4Octets(v4);
  if (!octets) return false;
  const [o1, o2] = octets;
  return (
    o1 === 127 || // 环回 127/8
    o1 === 10 || // 私网 10/8
    (o1 === 172 && o2 >= 16 && o2 <= 31) || // 私网 172.16/12（数值区间判断，勿仅靠正则壳）
    (o1 === 192 && o2 === 168) || // 私网 192.168/16
    (o1 === 169 && o2 === 254) // 链路本地 169.254/16
  );
}

/**
 * 从请求中提取客户端标识（限流计数键），按"可信对端"模型还原真实客户端 IP：
 *
 *  ① socket 对端（req.ip）为公网地址 ⇒ 客户端直连、不存在可信代理，
 *     直接采用 socket 地址，忽略一切客户端可伪造的代理头（修复 TC-RATE-02）；
 *  ② 对端为私网/环回（反向代理、容器网桥、本机回环）⇒ 采信代理头：
 *     优先 x-forwarded-for 尾段（可信反代将客户端真实 IP append 到尾部），
 *     不再取首段——首段可被客户端任意伪造（修复 TC-RATE-03）；
 *  ③ x-real-ip 次之；
 *  ④ 兜底 socket 地址；全部缺失（本地开发无代理头）返回 "local"。
 *
 * [运行时说明] Next.js 16 的 NextRequest 类型与运行时不再提供 ip 属性
 * （框架将 socket 对端的可信判定移交部署层）。socketPeerIp 采用运行时安全读取：
 * 若适配层注入 ip，① 直连公网分支生效；未注入时退化为按 [部署约束] 采信代理头。
 *
 * [部署约束] 生产部署必须满足，否则限流键仍可能被伪造：
 *  1. 所有流量必须经可信反向代理入口（客户端不可绕过代理直连应用）；
 *  2. 反代将客户端真实 IP append 到 X-Forwarded-For 尾部（而非覆写整串或只信任首段）；
 *  3. 强制覆写 X-Real-Ip（剥离客户端传入的原始值）。
 */
export function clientKey(req: NextRequest): string {
  const socketIp = socketPeerIp(req);

  // ① 直连公网：只用 socket 地址，伪造头攻击完全失效
  if (socketIp && !isPrivateIp(socketIp)) return socketIp;

  // ② 私网对端（反代/容器网桥）：取 XFF 尾段（可信代理追加的真实客户端 IP）
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const segments = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) return last;
  }

  // ③ x-real-ip 次之
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  // ④ 兜底：socket 地址；再缺失（本地开发无代理头）返回 "local"
  return socketIp ?? "local";
}

/**
 * 运行时安全读取 socket 对端地址：Next.js 16 的 NextRequest 类型声明中已移除 ip，
 * 但部分适配层/运行环境仍可能注入。此处用最小结构化断言读取，避免类型错误，
 * 同时保证注入存在时 ① 直连公网判定生效、缺失时优雅退化。
 */
function socketPeerIp(req: NextRequest): string | undefined {
  const maybeIp: unknown = (req as unknown as { ip?: unknown }).ip;
  if (typeof maybeIp !== "string") return undefined;
  const first = maybeIp.split(",")[0]?.trim();
  return first || undefined;
}

/**
 * 路由层便捷封装：未超限返回 null（放行）；
 * 超限直接返回 429 响应（含 Retry-After 头），调用方原样 return 即可。
 *
 * RATE_LIMIT_DISABLED === "1" 时整体禁用（集成测试环境：
 * 同源高频请求会被限流拦截，测试环境关闭）。
 */
export async function checkRateLimit(
  req: NextRequest,
  bucket: string,
  rule: RateLimitRule,
): Promise<NextResponse | null> {
  if (process.env.RATE_LIMIT_DISABLED === "1") {
    return null;
  }
  const result = await hitStore(`${bucket}:${clientKey(req)}`, rule.max, rule.windowMs);
  if (result.ok) return null;
  return NextResponse.json(
    { code: 429, message: "请求过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
  );
}
