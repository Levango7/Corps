// Web Push 推送封装 — VAPID 密钥管理 + sendPush 发送
//
// 依赖 web-push（npm）：封装 VAPID 配置与 sendNotification，对外暴露
// getVapidPublicKey（前端订阅用）+ sendPush（cron 发送用）。
// 失败不抛异常，仅记日志并返回 false，由调用方决定后续处理。

import webpush from "web-push";
// P1-fix: 用 web-push 库的精确类型替代 as any
import type { PushSubscription as WebPushSubscription } from "web-push";
import { logger } from "@/lib/logger";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@corps.app";

let configured = false;
function ensureVapid() {
  if (configured) return;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY 未配置");
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

/** 返回 VAPID 公钥（前端 ServiceWorker 订阅时需要） */
export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

/** sendPush 返回值：ok=是否成功，gone=订阅是否过期（410 Gone） */
export interface SendPushResult {
  /** true=发送成功，false=发送失败 */
  ok: boolean;
  /** true=订阅已过期（推送服务返回 410 Gone），调用方应删除该订阅 */
  gone?: boolean;
}

/**
 * 发送 Web Push 通知。
 *
 * @param subscription 浏览器 PushSubscription 的 endpoint + keys
 * @param payload 通知内容（title/body/url，JSON 序列化后作为 push payload）
 * @returns { ok, gone }——ok=是否成功，gone=订阅是否过期（410 Gone，调用方应删除订阅）。
 *          失败不抛异常，仅记日志，由调用方决定后续处理。
 */
export async function sendPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: { title: string; body: string; url?: string },
): Promise<SendPushResult> {
  try {
    ensureVapid();
    await webpush.sendNotification(subscription as WebPushSubscription, JSON.stringify(payload), {
      TTL: 86400,
    });
    return { ok: true };
  } catch (err) {
    // web-push 库抛出 WebPushError，含 statusCode 字段。
    // 410 Gone 表示订阅已过期/失效，推送服务已删除该订阅，
    // 调用方应从 DB 删除对应 PushSubscription 记录，避免后续 cron 重复尝试发送。
    const statusCode = (err as { statusCode?: number }).statusCode;
    const gone = statusCode === 410;
    logger.warn("[web-push] sendPush failed", {
      error: err instanceof Error ? err.message : String(err),
      statusCode,
      gone,
    });
    return { ok: false, gone };
  }
}
