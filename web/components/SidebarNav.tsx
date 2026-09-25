"use client";

/**
 * 侧栏导航 —— 共享组件（桌面侧栏 + 移动抽屉共用同源）。
 *
 * layout.tsx 曾在桌面侧栏和移动抽屉中重复渲染 navGroups.map，
 * 合并为单套 SidebarNav 实现，通过 collapsed prop 控制折叠形态。
 *
 * 拆分说明：SidebarNav 保持 client component（被 layout.tsx client 引用），
 * 交互逻辑委托给 SidebarNavClient 子组件。
 */

import { useTranslations } from "next-intl";
import { SidebarNavClient, type NavItem, type NavGroup } from "./SidebarNavClient";

export type { NavItem, NavGroup };

interface SidebarNavProps {
  groups: NavGroup[];
  pathname: string;
  collapsed: boolean;
  notifHref: string;
  notifActive: boolean;
  unreadCount: number;
  /** 移动抽屉模式：点击链接后关闭抽屉 */
  onNavigate?: () => void;
  /** 桌面侧栏折叠按钮回调（仅桌面模式显示） */
  onToggleCollapse?: () => void;
  /** 移动抽屉关闭按钮回调（仅移动模式显示） */
  onClose?: () => void;
  /** 模式：desktop 桌面侧栏 / mobile 移动抽屉 */
  mode: "desktop" | "mobile";
}

export function SidebarNav({
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
}: SidebarNavProps) {
  const t = useTranslations("nav");

  return (
    <SidebarNavClient
      groups={groups}
      pathname={pathname}
      collapsed={collapsed}
      notifHref={notifHref}
      notifActive={notifActive}
      unreadCount={unreadCount}
      onNavigate={onNavigate}
      onToggleCollapse={onToggleCollapse}
      onClose={onClose}
      mode={mode}
      notificationsLabel={t("menu.notifications")}
      expandLabel={t("sidebar.expand")}
      collapseLabel={t("sidebar.collapse")}
      closeLabel={t("sidebar.close")}
    />
  );
}
