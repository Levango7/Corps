/**
 * F3 Widget 仪表盘 — 默认布局 + Widget 注册表（前端共享）。
 *
 * 设计依据：design/FEATURE-DESIGN-v0.7.md §3.6。
 *
 * 注意：RGLItem 类型与 DEFAULT_LAYOUTS 已在 web/lib/default-layouts.ts
 * （后端 API 路由与前端共享）定义。此处仅 re-export，避免重复定义漂移。
 * 本文件额外维护 WIDGET_REGISTRY（前端专属：Widget 标题 i18n key + 默认尺寸）。
 *
 * 经验来源：2026-09-10-nextjs-global-error-zero-dependency-inline-token
 *   — 共享数据模块从单一源 re-export，避免多份定义漂移。
 */

// 从后端共享模块 re-export 类型与默认布局（单一编辑源）
export type { RGLItem } from "@/lib/default-layouts";
export { DEFAULT_LAYOUTS, getDefaultLayout, isRGLLayout } from "@/lib/default-layouts";

/**
 * Widget 注册表：每个 Widget 的 i18n 标题 key 与默认尺寸。
 * - titleKey：在 dashboard i18n 命名空间下的标题翻译 key
 * - defaultW / defaultH：添加 Widget 时使用的默认尺寸（与 DEFAULT_LAYOUTS 中保持一致）
 * - minW / minH：最小尺寸约束（编辑模式下生效）
 *
 * 8 个 Widget 与后端 widgets/[widgetId]/route.ts 白名单一一对齐。
 */
export const WIDGET_REGISTRY: Record<
  string,
  { titleKey: string; defaultW: number; defaultH: number; minW?: number; minH?: number }
> = {
  "task-stats": { titleKey: "taskStats", defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
  "my-tasks": { titleKey: "myTasks", defaultW: 2, defaultH: 2, minW: 2, minH: 1 },
  "decision-actions": { titleKey: "decisionActions", defaultW: 2, defaultH: 1, minW: 2, minH: 1 },
  "due-this-week": { titleKey: "dueThisWeek", defaultW: 2, defaultH: 1, minW: 2, minH: 1 },
  "team-load": { titleKey: "teamLoad", defaultW: 2, defaultH: 2, minW: 2, minH: 1 },
  "burndown": { titleKey: "burndown", defaultW: 3, defaultH: 2, minW: 2, minH: 2 },
  "priority-dist": { titleKey: "priorityDist", defaultW: 1, defaultH: 1, minW: 1, minH: 1 },
  "recent-activity": { titleKey: "recentActivity", defaultW: 2, defaultH: 1, minW: 1, minH: 1 },
  "gantt-chart": { titleKey: "ganttChart", defaultW: 4, defaultH: 3, minW: 3, minH: 2 },
  "milestone-timeline": { titleKey: "milestoneTimeline", defaultW: 2, defaultH: 3, minW: 2, minH: 2 },
  "custom-chart": { titleKey: "customChart", defaultW: 2, defaultH: 2, minW: 2, minH: 1 },
};

/** 已注册的 Widget id 列表（用于「添加 Widget」对话框展示可选项） */
export const WIDGET_IDS = Object.keys(WIDGET_REGISTRY);

/** 类型守卫：判断字符串是否为已注册的 Widget id */
export function isWidgetId(id: string): boolean {
  return id in WIDGET_REGISTRY;
}