import { redirect } from "@/lib/i18n-navigation";

/**
 * 根路径 → /auth/login
 *
 * 使用 i18n-navigation 的 redirect 配合 middleware 的 locale 协商：
 *  - 访问 / → middleware 检测 locale → 重定向到 /auth/login（zh，as-needed 无前缀）或 /en/auth/login（en）
 *  - 本组件仅在 middleware 未重定向时作为兜底
 */
export default async function RootPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: "/auth/login", locale });
}
