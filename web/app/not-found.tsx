/**
 * 全局 404 页面 · app/not-found.tsx
 *
 * 当 root 级别调用 notFound() 或匹配不到任何路由段时渲染。
 *
 * ⚠️ 重要约束：本项目无 app/layout.tsx，根布局即 app/[locale]/layout.tsx。
 * 本组件位于 [locale] 段之外，NextIntlClientProvider 不可用，故：
 *  - 不能使用 useTranslations / getTranslations
 *  - 使用中文硬编码文本（全局 fallback）
 *  - 自带 <html> 与 <body> 标签，并手动导入全局样式（globals.css）
 *
 * 样式走 design tokens（var(--token)），与 error.tsx 设计风格保持一致。
 */

import { AlertTriangle, Home } from "lucide-react";
import { Logo } from "@/components/Logo";
import Link from "next/link";
import "./globals.css";

export default function GlobalNotFound() {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <body className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--fg)] px-[var(--space-4)]">
        <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-6)] text-center">
          {/* 品牌 Logo */}
          <div className="flex justify-center mb-5">
            <Logo size={32} />
          </div>
          <AlertTriangle
            size={40}
            className="mx-auto text-[var(--danger)] mb-4"
            strokeWidth={1.5}
          />
          <h2 className="text-[length:var(--text-xl)] font-[var(--weight-semibold)] text-[var(--fg)] mb-2">
            页面未找到
          </h2>
          <p className="text-[length:var(--text-sm)] text-[var(--muted)] mb-1">
            你访问的页面不存在或已被移动。
          </p>
          <div className="flex items-center justify-center gap-[var(--space-2)] mt-5">
            <Link
              href="/"
              className="inline-flex items-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-base)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
            >
              <Home size={15} />
              返回首页
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}