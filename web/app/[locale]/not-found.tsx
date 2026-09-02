/**
 * locale 段内 404 页面 · app/[locale]/not-found.tsx
 *
 * 当 [locale] 段内子路由调用 notFound() 或匹配不到任何路由段时，
 * Next.js 渲染本组件替代 404 默认页，保留 [locale]/layout.tsx（顶栏/侧栏/全局 CSS 不丢失）。
 *
 * - 服务端组件：使用 getTranslations 获取翻译
 * - 复用 error.notFound / error.notFoundDesc / error.notFoundAction 翻译键
 * - 设计风格与 error.tsx 一致：居中卡片 + AlertTriangle + 描述 + 返回按钮
 * - 使用 Logo 组件保持品牌一致性
 * - 返回按钮使用 i18n 感知的 Link 跳转到 /auth/login
 */

import { getTranslations, setRequestLocale } from "next-intl/server";
import { AlertTriangle, Home } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Link } from "@/lib/i18n-navigation";

export default async function LocaleNotFound({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // 启用 RSC 静态渲染注水（next-intl App Router 推荐）
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "error" });

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-[60vh] flex items-center justify-center px-[var(--space-4)]"
    >
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-6)] text-center">
        {/* 品牌 Logo */}
        <div className="flex justify-center mb-5">
          <Logo size={32} />
        </div>
        <AlertTriangle size={40} className="mx-auto text-[var(--danger)] mb-4" strokeWidth={1.5} />
        <h2 className="text-[length:var(--text-xl)] font-[var(--weight-semibold)] text-[var(--fg)] mb-2">
          {t("notFound")}
        </h2>
        <p className="text-[length:var(--text-sm)] text-[var(--muted)] mb-1">{t("notFoundDesc")}</p>
        <div className="flex items-center justify-center gap-[var(--space-2)] mt-5">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-base)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
          >
            <Home size={15} />
            {t("notFoundAction")}
          </Link>
        </div>
      </div>
    </div>
  );
}
