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
            静态脚本文件（public/theme-init.js），不使用内联注入。 */}
        <script src="/theme-init.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
