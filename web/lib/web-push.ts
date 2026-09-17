// Web Push 推送封装 — VAPID 密钥管理 + sendPush 发送
//
// 依赖 web-push（npm）：封装 VAPID 配置与 sendNotification，对外暴露
// getVapidPublicKey（前端订阅用）+ sendPush（cron 发送用）。
// 失败不抛异常，仅记日志并返回 false，由调用方决定后续处理。

import webpush from "web-push";
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

/**
 * 发送 Web Push 通知。
 *
 * @param subscription 浏览器 PushSubscription 的 endpoint + keys
 * @param payload 通知内容（title/body/url，JSON 序列化后作为 push payload）
 * @returns true=发送成功，false=发送失败（已记日志，不抛异常）
 */
export async function sendPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: { title: string; body: string; url?: string },
): Promise<boolean> {
  try {
    ensureVapid();
    await webpush.sendNotification(
      subscription as any,
      JSON.stringify(payload),
      { TTL: 86400 },
    );
    return true;
  } catch (err) {
    logger.warn("[web-push] sendPush failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}