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
import { useEffect, useRef, type ReactNode } from "react";

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
}

export function QuickActionMenu({
  open,
  onClose,
  actions,
  x,
  y,
  children,
}: QuickActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

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
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
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

  return (
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
                  action.danger
                    ? "text-[var(--danger)]"
                    : "text-[var(--fg)]"
                }`}
              >
                <Icon size={16} className="shrink-0" />
                {action.label}
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}