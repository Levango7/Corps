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
  // F7: 4列→12列网格（w/x ×3）。
  // 2026-10-10 高度修正：rowHeight 80→60 时 h 应 ×1.33，原 ×0.75 是反向缩放——
  // 全部 Widget 高度只有应有值的 ~56%，内容被裁切/出内滚动条。按内容实际需要
  // （统计卡 ~200px / 图表 ~240px / 列表 ~240px）重定 defaultH 与 minH。
  "task-stats": { titleKey: "taskStats", defaultW: 3, defaultH: 4, minW: 2, minH: 2 },
  "my-tasks": { titleKey: "myTasks", defaultW: 6, defaultH: 4, minW: 4, minH: 3 },
  "decision-actions": { titleKey: "decisionActions", defaultW: 6, defaultH: 4, minW: 4, minH: 2 },
  "due-this-week": { titleKey: "dueThisWeek", defaultW: 6, defaultH: 4, minW: 4, minH: 2 },
  "team-load": { titleKey: "teamLoad", defaultW: 6, defaultH: 4, minW: 4, minH: 2 },
  burndown: { titleKey: "burndown", defaultW: 9, defaultH: 4, minW: 6, minH: 3 },
  "priority-dist": { titleKey: "priorityDist", defaultW: 3, defaultH: 4, minW: 2, minH: 2 },
  "recent-activity": { titleKey: "recentActivity", defaultW: 6, defaultH: 4, minW: 3, minH: 2 },
  "gantt-chart": { titleKey: "ganttChart", defaultW: 12, defaultH: 6, minW: 6, minH: 4 },
  "milestone-timeline": {
    titleKey: "milestoneTimeline",
    defaultW: 6,
    defaultH: 5,
    minW: 4,
    minH: 3,
  },
  "custom-chart": { titleKey: "customChart", defaultW: 6, defaultH: 5, minW: 4, minH: 3 },
};

/** 已注册的 Widget id 列表（用于「添加 Widget」对话框展示可选项） */
export const WIDGET_IDS = Object.keys(WIDGET_REGISTRY);

/** 类型守卫：判断字符串是否为已注册的 Widget id */
export function isWidgetId(id: string): boolean {
  return id in WIDGET_REGISTRY;
}
