import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { PublicPageTracker } from "@/lib/analytics-attribution";
import { locales, type Locale, localeToBcp47 } from "@/lib/i18n";

import "../globals.css";

/** 静态生成所有支持的 locale。 */
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/** 动态 metadata：按 locale 取翻译。 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // 非法 locale 直接 404
  if (!hasLocale(locales, locale)) notFound();

  // 启用 RSC 静态渲染注水（next-intl App Router 推荐）
  setRequestLocale(locale);

  const h = await headers();
  const nonce = h.get("x-nonce") ?? "";

  // 取 messages 供 NextIntlClientProvider 注水到客户端
  const messages = (await import(`@/messages/${locale}.json`)).default;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <html lang={localeToBcp47[locale as Locale]} data-theme="light" suppressHydrationWarning>
        <head>
          {/* 首帧前同步解析主题偏好，避免深色用户看到一次浅色闪白。
              必须同步执行（不能 async/defer），故显式豁免 no-sync-scripts。 */}
          {/* eslint-disable-next-line @next/next/no-sync-scripts */}
          <script src="/theme-init.js" nonce={nonce} />
        </head>
        <body>
          {/* Web Vitals 采集：渲染 null，仅挂载监控钩子。 */}
          <WebVitalsReporter />
          {/* P2 数据埋点：公开页曝光归因（landing_view），渲染 null，仅挂载追踪钩子。 */}
          <PublicPageTracker />
          {children}
        </body>
      </html>
    </NextIntlClientProvider>
  );
}
