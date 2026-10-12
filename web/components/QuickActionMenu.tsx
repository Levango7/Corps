"use client";

/**
 * QuickActionMenu — 长按触发的浮窗快捷操作菜单。
 *
 * framer-motion 弹簧入场（scale 0.8→1 + opacity 0→1 + y 8→0），
 * 点击外部或 Esc 关闭。z-index 用 var(--z-dropdown)。
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §4.1 长按浮窗菜单
 */

import { AnimatePresence, motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface QuickAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** 危险操作（删除等），用 --danger 色 */
  danger?: boolean;
}

export interface QuickActionMenuProps {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 操作列表 */
  actions: QuickAction[];
  /** 触发位置（长按坐标） */
  x: number;
  y: number;
  /** 子元素（触发长按的元素） */
  children?: ReactNode;
  /** ESLint unused-args 兼容：内部别名 */
  _children?: ReactNode;
}

export function QuickActionMenu({ open, onClose, actions, x, y, _children }: QuickActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  /** createPortal 需要 document；SSR / 首帧不渲染，避免 Next.js hydration mismatch */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /**
   * 已知遗留（不在本次修复范围，勿顺手改）：
   * 坐标直接用长按点，屏幕右缘 / 下缘打开时菜单会有一截超出视口——
   * 长按点在 1150px、视口 1280px 时，min-w-[160px] 的菜单右缘会到 1310px。
   * 修法是把长按点按菜单实测尺寸夹回视口内，且必须用 offsetWidth/offsetHeight
   * 而非 getBoundingClientRect（后者受入场 scale(0.8) 影响会量偏小）。
   * 没有一起改的原因：它会改变「菜单贴合触发点」这一可观测行为，
   * 需要配套改 web/e2e/fixed-overlay-portal.spec.ts 的 ±4px 断言，单独一个 PR 做。
   */

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟绑定避免触发长按的 click 事件
    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", handleClickOutside);
    };
  }, [open, onClose]);

  // Focus trap：菜单打开时聚焦首个可聚焦元素，Tab/Shift+Tab 在菜单内循环，
  // 关闭时恢复焦点到触发元素（WAI-ARIA Menu 浮窗规范）
  useEffect(() => {
    if (!open) return;

    // 记录打开前的焦点元素，关闭时恢复
    const previousActiveElement = document.activeElement as HTMLElement | null;

    // 获取菜单内所有可聚焦元素
    const getFocusableElements = () => {
      if (!menuRef.current) return [];
      return Array.from(
        menuRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
    };

    // 初始聚焦首个可聚焦元素
    const initialFocusable = getFocusableElements();
    if (initialFocusable.length > 0) {
      initialFocusable[0].focus();
    }

    // Tab / Shift+Tab 在首尾元素间循环
    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (!menuRef.current) return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab：从第一个跳到最后一个
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab：从最后一个跳到第一个
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    window.addEventListener("keydown", handleTabKey);

    return () => {
      window.removeEventListener("keydown", handleTabKey);
      // 关闭时恢复焦点到触发元素
      if (previousActiveElement) {
        previousActiveElement.focus();
      }
    };
  }, [open]);

  if (!mounted) return null;

  /**
   * portal 到 document.body，**不能**就地渲染在触发元素旁边。
   *
   * 原因（2026-10-12 实测）：调用方传进来的 x/y 是 `useLongPress` 的
   * `e.clientX / e.clientY`（web/lib/use-long-press.ts:48），即**视口坐标**；
   * 本菜单用 `position: fixed` 按视口定位，语义是匹配的。但只要任一祖先带
   * `transform` / `perspective` / `filter` / `will-change: transform` / `contain`，
   * `fixed` 的包含块就被改到那个祖先上，视口坐标被当成祖先盒内坐标解析，菜单整体偏移。
   *
   * 实测触发点：WidgetCard 根元素挂着 `perspective: var(--perspective-card)`
   * （非 reduced 档常驻）；拖拽时还有 `scale-[1.02]`。调用方 board-parts.tsx /
   * DocumentListView.tsx 同样在滚动容器内，未来插一层 transform 就会复发。
   * portal 到 body 让定位不再依赖祖先，属结构性修法。
   */
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.8, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 8 }}
          transition={{ type: "spring", stiffness: 400, damping: 28, mass: 1 }}
          style={{
            position: "fixed",
            left: x,
            top: y,
            zIndex: "var(--z-dropdown)",
          }}
          className="min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-md)] overflow-hidden"
        >
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
                className={`flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--hover-soft)] ${
                  action.danger ? "text-[var(--danger)]" : "text-[var(--fg)]"
                }`}
              >
                <Icon size={16} className="shrink-0" />
                {action.label}
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
