"use client";

/**
 * 移动端底部导航 · components/layout/MobileBottomNav.tsx
 *
 * 职责：
 *  - 仅在工作区路由（/w/{wid}/...）且移动端（md 以下）显示。
 *  - 四个 Tab：任务 / 消息 / 文档 / 我的，对应工作区子路由。
 *  - 当前 Tab 高亮（强调色），其余用 muted 色。
 *  - active Tab 顶部有滑动指示条（framer-motion layout animation），
 *    切换时平滑滑动；尊重 prefers-reduced-motion 时直接跳转无动画。
 *
 * 设计：
 *  - md:hidden：桌面端不渲染底部导航（桌面用侧栏 SidebarNav）。
 *  - 固定底部，safe-area 内缩，避免被 iOS 手势条遮挡。
 *  - 全部样式走 design token（var(--*)），无裸 hex。
 *  - 图标用 lucide-react，size 24（--icon-lg），2px stroke、currentColor。
 *  - 文案复用 nav.menu 命名空间（myTasks / messages / documents / settings），
 *    不新增 i18n key。
 *  - 触摸目标 ≥ 44px（WCAG 2.5.5 Target Size）：min-h-[44px] 保证。
 *
 * 路由感知：用 @/lib/i18n-navigation 的 usePathname / Link，
 *  自动处理 locale 前缀（as-needed 策略下默认 zh 不带前缀）。
 *
 * 动画降级（来源：2026-09-13-framer-motion-userreducedmotion-component-level-reduction）：
 *  - useReducedMotion() 返回 true 时，指示条 transition duration 设为 0，
 *    直接跳转到新位置无滑动动画。
 */

import { usePathname, Link } from "@/lib/i18n-navigation";
import { useTranslations } from "next-intl";
import { CheckSquare, MessageSquare, FileText, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

interface NavTab {
  /** i18n key（nav.menu 命名空间下）。 */
  key: "myTasks" | "messages" | "documents" | "settings";
  /** 工作区子路径段。 */
  segment: "my-tasks" | "im" | "documents" | "settings";
  /** lucide 图标组件。 */
  Icon: LucideIcon;
}

const TABS: NavTab[] = [
  { key: "myTasks", segment: "my-tasks", Icon: CheckSquare },
  { key: "messages", segment: "im", Icon: MessageSquare },
  { key: "documents", segment: "documents", Icon: FileText },
  { key: "settings", segment: "settings", Icon: User },
];

/** active 指示条 layoutId，framer-motion 据此做 layout animation 平滑滑动 */
const INDICATOR_LAYOUT_ID = "mobile-bottom-nav-indicator";

export function MobileBottomNav() {
  const pathname = usePathname();
  const t = useTranslations("nav.menu");
  // 尊重 prefers-reduced-motion：降级时指示条直接跳转，无滑动动画
  const reduceMotion = useReducedMotion();

  // 仅在工作区路由渲染：pathname 形如 /w/{wid}/...
  // next-intl usePathname 已剥离 locale 前缀。
  const match = pathname.match(/^\/w\/([^/]+)/);
  if (!match) return null;
  const wid = match[1];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] flex md:hidden border-t border-[var(--border)] bg-[var(--surface)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label={t("navLabel")}
    >
      {TABS.map(({ key, segment, Icon }) => {
        const href = `/w/${wid}/${segment}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-label={t(key)}
            aria-current={active ? "page" : undefined}
            className="relative flex flex-1 flex-col items-center justify-center gap-1 py-2 min-h-[44px] focus:outline-none focus-visible:[box-shadow:var(--focus-ring)]"
          >
            {/* active 指示条：framer-motion layout animation 平滑滑动 */}
            {active && (
              <motion.div
                layoutId={INDICATOR_LAYOUT_ID}
                className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[var(--accent)]"
                transition={
                  reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }
                }
              />
            )}
            <Icon
              size={24}
              strokeWidth={2}
              className={active ? "text-[var(--accent)]" : "text-[var(--muted)]"}
            />
            <span
              className={
                active
                  ? "text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--accent)]"
                  : "text-[length:var(--text-xs)] text-[var(--muted)]"
              }
            >
              {t(key)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
