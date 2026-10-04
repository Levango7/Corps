"use client";

/**
 * PWA 注册与安装提示 · components/pwa/PwaRegister.tsx
 *
 * 职责：
 *  - 生产环境注册 /sw.js（开发环境跳过，避免缓存干扰热更新）。
 *  - 监听 beforeinstallprompt，展示安装横条；用户安装或关闭后不再出现。
 *  - 监听 appinstalled，安装完成后隐藏提示。
 *
 * 设计：
 *  - 仅在生产环境注册 SW：开发环境 SW 会缓存静态资源，与 Next dev 热更新冲突。
 *  - 安装横条固定底部居中，z 略高于底部导航（var(--z-sticky)+1），避免被遮挡。
 *  - 全部样式走 design token（var(--*)），无裸 hex。
 *  - 图标用 lucide-react，2px stroke、currentColor，遵循 design-tokens.css 图标约定。
 *
 * 依赖：next-intl useTranslations（pwa 命名空间由 layout 的 NextIntlClientProvider 注入）。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, X } from "lucide-react";
import { PushSubscribe } from "./PushSubscribe";

/** beforeinstallprompt 事件的标准外补类型（DOM lib 未收录）。 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * 清掉本应用写进 Cache Storage 的内容，登出 / 切换工作区时调用。
 *
 * public/sw.js 已不再缓存任何 /api 响应，但页面 shell 与 RSC payload 仍可能带着
 * 上一位登录者的租户内容留在缓存里——共享/公用设备上这是一个暴露面（同一类问题的
 * 另一半，见 sw.js 里 isNonCacheableApi 的注释）。只删 corps-sw* 前缀，不碰其它来源。
 */
export async function clearAppCaches(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith("corps-sw")).map((key) => caches.delete(key)),
  );
}

export function PwaRegister() {
  const t = useTranslations("pwa");
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // 仅生产环境注册；开发环境 SW 会缓存资源，干扰热更新。
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // 未认证页面（/auth/*）先扫一遍缓存。
    // 为什么登出时那一次清理不够：SW 后台 revalidate 是脱离请求链的 promise
    // （sw.js 里 networkUpdate → cache.put），登出导航时仍有侧栏预取在飞行中，
    // 它们会在"删除之后"把租户页面写回同一个桶——生产实测登出后残留 5 条 /w/{wid}/*。
    // 共享设备上下一位使用者必然是从 /auth 进来，所以在这里兜一次底：
    // 让"没有任何租户内容"成为进入登录/注册页时的不变量。
    if (window.location.pathname.includes("/auth/")) void clearAppCaches();

    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.info("[pwa] service worker register failed:", err));

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // 已安装 / 已关闭 / 未触发安装事件 → 不渲染。
  if (installed || dismissed || !installEvent) return null;

  const handleInstall = async () => {
    try {
      await installEvent.prompt();
    } catch {
      // prompt() 在部分浏览器会抛错（如已安装），静默忽略。
    }
    setInstallEvent(null);
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[1101] flex justify-center px-4 md:px-6"
      style={{
        paddingBottom: "calc(env(safe-area-inset-bottom) + var(--space-3))",
      }}
    >
      <div
        className="flex w-full max-w-md items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--elev-md)]"
        role="dialog"
        aria-label={t("installPrompt")}
      >
        <Download size={20} strokeWidth={2} className="shrink-0 text-[var(--accent)]" />
        <p className="flex-1 text-[length:var(--text-sm)] leading-[var(--leading-snug)] text-[var(--fg)]">
          {t("installPrompt")}
        </p>
        <button
          type="button"
          onClick={handleInstall}
          className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:[box-shadow:var(--focus-ring)]"
        >
          {t("install")}
        </button>
        <PushSubscribe />
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("dismiss")}
          className="shrink-0 text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:text-[var(--fg)] focus:outline-none focus-visible:[box-shadow:var(--focus-ring)]"
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
