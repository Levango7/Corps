import type { Metadata } from "next";
import { headers } from "next/headers";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import "./globals.css";

export const metadata: Metadata = {
  title: "corps · 团队",
  description: "面向中小团队的轻量协作 SaaS",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-nonce") ?? "";

  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head>
        {/* 首帧前同步解析主题偏好，避免深色用户看到一次浅色闪白。
            必须同步执行（不能 async/defer），故显式豁免 no-sync-scripts。 */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" nonce={nonce} />
      </head>
      <body>
        {/* Web Vitals 采集：渲染 null，仅挂载监控钩子。 */}
        <WebVitalsReporter />
        {children}
      </body>
    </html>
  );
}
