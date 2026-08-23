import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "corps · 团队",
  description: "面向中小团队的轻量协作 SaaS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head>
        {/* 首帧前同步解析主题偏好，避免深色用户看到一次浅色闪白。
            必须同步执行（不能 async/defer），故显式豁免 no-sync-scripts。 */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
