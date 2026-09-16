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

/** beforeinstallprompt 事件的标准外补类型（DOM lib 未收录）。 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaRegister() {
  const t = useTranslations("pwa");
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // 仅生产环境注册；开发环境 SW 会缓存资源，干扰热更新。
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .catch((err) => console.warn("[pwa] service worker register failed:", err));

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
        <Download
          size={20}
          strokeWidth={2}
          className="shrink-0 text-[var(--accent)]"
        />
        <p className="flex-1 text-sm leading-[var(--leading-snug)] text-[var(--fg)]">
          {t("installPrompt")}
        </p>
        <button
          type="button"
          onClick={handleInstall}
          className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--accent-hover)] focus:outline-none focus-visible:[box-shadow:var(--focus-ring)]"
        >
          {t("install")}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("dismiss")}
          className="shrink-0 text-[var(--muted)] transition-colors duration-[var(--motion-fast)] hover:text-[var(--fg)] focus:outline-none focus-visible:[box-shadow:var(--focus-ring)]"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}