"use client";

/**
 * 公开页曝光归因采集（FUNNEL-METRICS §3.1 / §6.1，裁决一）。
 *
 * 设计：
 *  - PublicPageTracker 挂在根 layout，命中公开路由白名单时打 landing_view 事件。
 *  - landing_view ＝ 全站公开页曝光基线（获客段漏斗第一步 + ADR-008 S1 国际化信号载体）。
 *  - utm/referrer first-touch：仅 landing_view 采集一次，后续事件不重复采集；
 *    查询侧以 sessionId 等值 join 还原渠道（[sessionId,createdAt] 索引已备）。
 *  - 每 sid 每路径会话内至多一条：模块级 Set 记录已上报 (sid,path)，SPA 内跳转去重。
 *  - PII 边界：referrer 只存 document.referrer 原始串；utm 值截断 128 字符；
 *    仅识别 utm_ 前缀键，禁止误收 email/姓名类 query 参数。
 *
 * 与 view_pricing 的边界（裁决一）：两者共存不互斥。landing_view ＝ 全站公开页曝光基线，
 * view_pricing ＝ 定价页专属曝光。/pricing 单次 PV 两条事件并存，各自独立会话去重，
 * 漏斗各走各的——获客段用 landing_view（path=/pricing 可过滤），spec §8 转化漏斗用 view_pricing。
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "./analytics";

/** 公开路由白名单（命中即打 landing_view）。 */
const PUBLIC_LANDING_ROUTES = ["/", "/pricing", "/auth/login", "/auth/signup"];

/** 判断 pathname 是否命中公开路由（支持前缀匹配 /pricing/* 与 /auth/*）。 */
function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_LANDING_ROUTES.includes(pathname)) return true;
  if (pathname === "/pricing" || pathname.startsWith("/pricing/")) return true;
  if (pathname.startsWith("/auth/")) return true;
  return false;
}

/** utm 值截断长度（防滥用）。 */
const UTM_MAX_LEN = 128;

/**
 * 解析 landing_view props：referrer + utm 三键（camelCase）。
 * 缺省键不出现在 props；utm 仅识别 utm_ 前缀键。
 */
export function captureLandingAttribution(): {
  referrer: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  path: string;
  locale: string;
} {
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const truncate = (v: string | null): string | undefined => {
    if (!v) return undefined;
    return v.slice(0, UTM_MAX_LEN);
  };
  const props: {
    referrer: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    path: string;
    locale: string;
  } = {
    referrer: typeof document !== "undefined" ? document.referrer : "",
    path: typeof window !== "undefined" ? window.location.pathname : "",
    locale: typeof navigator !== "undefined" ? navigator.language : "zh-CN",
  };
  const utmSource = truncate(search?.get("utm_source") ?? null);
  const utmMedium = truncate(search?.get("utm_medium") ?? null);
  const utmCampaign = truncate(search?.get("utm_campaign") ?? null);
  if (utmSource) props.utmSource = utmSource;
  if (utmMedium) props.utmMedium = utmMedium;
  if (utmCampaign) props.utmCampaign = utmCampaign;
  return props;
}

/**
 * R8D-11 / R9D-11 修复：reported 改为 Map<path, timestamp>，按时间戳过期清理。
 * 原实现用 Set + 10 分钟全量 clear，问题：clear 会把当前会话内已上报的 path 也清掉，
 * 导致 SPA 内跳回已访问过的公开页时重复打 landing_view 事件（违反"每 sid 每路径会话内
 * 至多一条"约束）。改为按时间戳过期：仅清理超过 TTL 的条目，近期条目保留，
 * 既防内存泄漏又不破坏会话内去重语义。
 */
const REPORTED_TTL_MS = 30 * 60 * 1000; // 30 分钟过期（与 session TTL 对齐）
const reported = new Map<string, number>();

// R8D-11：定期清理 reported Map 中过期条目，防止内存泄漏
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [path, ts] of reported) {
      if (now - ts > REPORTED_TTL_MS) {
        reported.delete(path);
      }
    }
  }, 10 * 60 * 1000).unref?.(); // unref 避免阻止进程退出
}

/**
 * PublicPageTracker —— 挂在根 layout 的客户端组件。
 * 命中公开路由且本次加载未上报过该 path 时打 landing_view。
 */
export function PublicPageTracker(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (!isPublicRoute(pathname)) return;
    if (reported.has(pathname)) return;
    reported.set(pathname, Date.now());
    track("landing_view", captureLandingAttribution());
  }, [pathname]);

  return null;
}
