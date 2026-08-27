import { redirect } from "next/navigation";

/**
 * 根路径 → /auth/login
 *
 * 使用 next/navigation 的 redirect 配合 middleware 的 locale 协商：
 *  - 访问 / → middleware 检测 locale → 重定向到 /auth/login（zh，as-needed 无前缀）或 /en/auth/login（en）
 *  - 本组件仅在 middleware 未重定向时作为兜底
 */
export default function RootPage() {
  redirect("/auth/login");
}
