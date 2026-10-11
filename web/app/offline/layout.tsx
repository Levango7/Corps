import type { Viewport } from "next";
import { headers } from "next/headers";
import { defaultLocale, localeToBcp47 } from "@/lib/i18n";

import "../globals.css";

/**
 * 离线回退页的根布局。/offline 刻意放在 [locale] 段之外（Service Worker 的
 * 导航兜底，不参与 locale 路由），而 app/ 顶层没有 layout.tsx——根布局一直
 * 由 [locale]/layout.tsx 充当。Next 16.4 起强制「每个页面必须有根布局」，
 * 本文件即 /offline 自己的根布局。
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function OfflineLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-nonce") ?? "";

  return (
    <html
      lang={localeToBcp47[defaultLocale]}
      data-theme="light"
      data-density="compact"
      suppressHydrationWarning
    >
      <head>
        {/* 与 [locale] 布局同款首帧主题同步，避免深色用户在离线页闪白 */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" nonce={nonce} />
      </head>
      <body>{children}</body>
    </html>
  );
}
