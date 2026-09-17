"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, BellOff, AlertCircle } from "lucide-react";
import { logger } from "@/lib/logger";

export function PushSubscribe() {
  const t = useTranslations("pwa");
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  /** 错误提示（VAPID 未配置 / 订阅失败等），null 表示无错误 */
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupported("Notification" in window && "serviceWorker" in navigator);
    // 检查现有订阅
    navigator.serviceWorker?.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  if (!supported) return null;

  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. 获取 VAPID 公钥
      const res = await fetch("/api/v1/push/vapid");
      const json = await res.json();
      const publicKey = json.data?.publicKey;
      if (!publicKey) {
        // VAPID 公钥缺失 → 明确提示而非静默失败
        setError(t("pushNotConfigured"));
        logger.warn("PushSubscribe: VAPID public key missing", {
          status: res.status,
        });
        return;
      }

      // 2. 申请通知权限
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;

      // 3. 订阅 Push
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      // 4. 发送订阅到后端
      const subscribeRes = await fetch("/api/v1/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      const subscribeJson = await subscribeRes.json();
      if (subscribeJson.code !== 200) {
        setError(t("pushSubscribeFailed"));
        logger.warn("PushSubscribe: subscribe API failed", {
          code: subscribeJson.code,
        });
        return;
      }
      setSubscribed(true);
    } catch (e) {
      logger.error("PushSubscribe: subscribe error", {
        error: e instanceof Error ? e.message : String(e),
      });
      setError(t("pushSubscribeFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        const unsubscribeRes = await fetch("/api/v1/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        const unsubscribeJson = await unsubscribeRes.json();
        if (unsubscribeJson.code !== 200) {
          logger.warn("PushSubscribe: unsubscribe API failed", {
            code: unsubscribeJson.code,
          });
          return;
        }
      }
      setSubscribed(false);
    } catch (e) {
      logger.error("PushSubscribe: unsubscribe error", {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={subscribed ? handleUnsubscribe : handleSubscribe}
        disabled={loading}
        className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--fg)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
      >
        {subscribed ? <BellOff size={14} strokeWidth={2} /> : <Bell size={14} strokeWidth={2} />}
        {subscribed ? t("pushOff") : t("pushOn")}
      </button>
      {error && (
        <p
          className="flex items-center gap-1 text-[length:var(--text-xs)]"
          style={{ color: "var(--danger)" }}
        >
          <AlertCircle size={12} strokeWidth={2} className="shrink-0" />
          <span className="leading-[var(--leading-relaxed)]">{error}</span>
        </p>
      )}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  // 显式用 ArrayBuffer 构造，确保类型为 Uint8Array<ArrayBuffer>（兼容 BufferSource）。
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}