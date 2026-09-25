"use client";

/**
 * 侧栏导航 · client 交互部分
 *
 * 负责：onClick 事件处理（导航、折叠、关闭）
 */

import { Link } from "@/lib/i18n-navigation";
import { ChevronLeft, ChevronRight, Bell, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
  requiredPermission?: string;
  badge?: number;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

interface SidebarNavClientProps {
  groups: NavGroup[];
  pathname: string;
  collapsed: boolean;
  notifHref: string;
  notifActive: boolean;
  unreadCount: number;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
  onClose?: () => void;
  mode: "desktop" | "mobile";
  notificationsLabel: string;
  expandLabel: string;
  collapseLabel: string;
  closeLabel: string;
}

export function SidebarNavClient({
  groups,
  pathname,
  collapsed,
  notifHref,
  notifActive,
  unreadCount,
  onNavigate,
  onToggleCollapse,
  onClose,
  mode,
  notificationsLabel,
  expandLabel,
  collapseLabel,
  closeLabel,
}: SidebarNavClientProps) {
  return (
    <>
      <nav className="flex-1 overflow-y-auto py-[var(--space-3)] px-[var(--space-2)] space-y-[var(--space-1)]">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-[var(--space-1)]">
            {/* 分组标题：桌面折叠时用分隔线，移动始终用文字 */}
            {group.label && mode === "desktop" && !collapsed && (
              <div className="text-[length:var(--text-xs)] text-[var(--meta)] px-[var(--space-3)] pt-[var(--space-4)] pb-[var(--space-1)]">
                {group.label}
              </div>
            )}
            {group.label && mode === "desktop" && collapsed && (
              <div className="px-[var(--space-2)] pt-[var(--space-2)]">
                <div className="h-px bg-[var(--shell-edge)]" />
              </div>
            )}
            {group.label && mode === "mobile" && (
              <div className="text-[length:var(--text-xs)] text-[var(--meta)] px-[var(--space-3)] pt-[var(--space-4)] pb-[var(--space-1)]">
                {group.label}
              </div>
            )}
            {group.items.map(({ href, label, icon: Icon, exact, badge }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={`relative flex items-center gap-[var(--space-3)] px-[var(--space-3)] h-9 rounded-[var(--radius-md)] text-[length:var(--text-base)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                  } ${mode === "desktop" && collapsed ? "justify-center px-0" : ""}`}
                  title={mode === "desktop" && collapsed ? label : undefined}
                >
                  <Icon size={18} className="shrink-0" />
                  {!(mode === "desktop" && collapsed) && <span className="truncate">{label}</span>}
                  {!(mode === "desktop" && collapsed) && badge != null && badge > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center bg-[var(--danger)] text-[var(--accent-fg)] text-[length:var(--text-xs)] rounded-full px-1.5 h-5 min-w-[1.25rem]">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                  {mode === "desktop" && collapsed && badge != null && badge > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--danger)]" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* 通知入口：固定在侧栏底部，带未读 badge */}
      <div className="px-[var(--space-2)] pt-[var(--space-1)]">
        <Link
          href={notifHref}
          aria-current={notifActive ? "page" : undefined}
          onClick={onNavigate}
          className={`relative flex items-center gap-[var(--space-3)] px-[var(--space-3)] h-9 rounded-[var(--radius-md)] text-[length:var(--text-base)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] ${
            notifActive
              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
              : "text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
          } ${mode === "desktop" && collapsed ? "justify-center px-0" : ""}`}
          title={mode === "desktop" && collapsed ? notificationsLabel : undefined}
        >
          <Bell size={18} className="shrink-0" />
          {!(mode === "desktop" && collapsed) && (
            <span className="truncate">{notificationsLabel}</span>
          )}
          {!(mode === "desktop" && collapsed) && unreadCount > 0 && (
            <span className="ml-auto inline-flex items-center justify-center bg-[var(--danger)] text-[var(--accent-fg)] text-[length:var(--text-xs)] rounded-full px-1.5 h-5 min-w-[1.25rem]">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          {mode === "desktop" && collapsed && unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--danger)]" />
          )}
        </Link>
      </div>

      {/* 底部按钮：桌面折叠/展开，移动关闭 */}
      <button
        onClick={mode === "desktop" ? onToggleCollapse : onClose}
        className="m-[var(--space-2)] p-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg-2)] transition-colors duration-[var(--motion-fast)] flex items-center justify-center"
        aria-label={mode === "desktop" ? (collapsed ? expandLabel : collapseLabel) : closeLabel}
      >
        {mode === "desktop" ? (
          collapsed ? (
            <ChevronRight size={16} />
          ) : (
            <ChevronLeft size={16} />
          )
        ) : (
          <X size={16} />
        )}
      </button>
    </>
  );
}
