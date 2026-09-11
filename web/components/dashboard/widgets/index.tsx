"use client";

/**
 * F3 Widget 仪表盘 — Widget 组件注册表。
 *
 * 集中导出 8 个 Widget 组件 + 图标 + 标题 key 的映射，
 * 供 DashboardGrid 与 AddWidgetDialog 通过 widgetId 查找。
 *
 * 经验来源：2026-09-10-frontend-components-readonly-review-5d-methodology
 *   — 组件注册表集中管理，避免散落各处的 switch/case。
 */

import type { ComponentType } from "react";
import {
  BarChart3,
  CheckSquare,
  ClipboardList,
  CalendarClock,
  Users,
  TrendingDown,
  PieChart,
  Bell,
  type LucideIcon,
} from "lucide-react";

import TaskStatsWidget from "./TaskStatsWidget";
import MyTasksWidget from "./MyTasksWidget";
import DecisionActionsWidget from "./DecisionActionsWidget";
import DueThisWeekWidget from "./DueThisWeekWidget";
import TeamLoadWidget from "./TeamLoadWidget";
import BurndownWidget from "./BurndownWidget";
import PriorityDistWidget from "./PriorityDistWidget";
import RecentActivityWidget from "./RecentActivityWidget";

/** Widget 组件 Props（统一为 { wid }） */
export interface WidgetProps {
  wid: string;
}

/** Widget 组件类型 */
type WidgetComponent = ComponentType<WidgetProps>;

/**
 * Widget 注册表：widgetId → { component, icon, titleKey }
 * - component：Widget React 组件
 * - icon：标题栏图标（lucide-react）
 * - titleKey：dashboard i18n 命名空间下的标题翻译 key
 */
const WIDGET_COMPONENTS: Record<string, { component: WidgetComponent; icon: LucideIcon; titleKey: string }> = {
  "task-stats": { component: TaskStatsWidget, icon: BarChart3, titleKey: "taskStats" },
  "my-tasks": { component: MyTasksWidget, icon: CheckSquare, titleKey: "myTasks" },
  "decision-actions": { component: DecisionActionsWidget, icon: ClipboardList, titleKey: "decisionActions" },
  "due-this-week": { component: DueThisWeekWidget, icon: CalendarClock, titleKey: "dueThisWeek" },
  "team-load": { component: TeamLoadWidget, icon: Users, titleKey: "teamLoad" },
  "burndown": { component: BurndownWidget, icon: TrendingDown, titleKey: "burndown" },
  "priority-dist": { component: PriorityDistWidget, icon: PieChart, titleKey: "priorityDist" },
  "recent-activity": { component: RecentActivityWidget, icon: Bell, titleKey: "recentActivity" },
};

/** 占位 Widget（未知 widgetId 时使用，避免渲染崩溃） */
const FallbackWidget: WidgetComponent = () => {
  return (
    <div className="p-4 text-center text-[length:var(--text-xs)] text-[var(--meta)]">
      Unknown widget
    </div>
  );
};

/** 根据 widgetId 获取 Widget 组件 */
export function getWidgetComponent(id: string): WidgetComponent {
  return WIDGET_COMPONENTS[id]?.component ?? FallbackWidget;
}

/** 根据 widgetId 获取 Widget 标题栏图标 */
export function getWidgetIcon(id: string): LucideIcon {
  return WIDGET_COMPONENTS[id]?.icon ?? BarChart3;
}

/** 根据 widgetId 获取 Widget 标题 i18n key */
export function getWidgetTitleKey(id: string): string {
  return WIDGET_COMPONENTS[id]?.titleKey ?? "unknownWidget";
}