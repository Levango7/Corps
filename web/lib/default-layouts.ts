/**
 * F3 Widget 仪表盘 — 默认布局配置（按角色）。
 *
 * 设计依据：design/FEATURE-DESIGN-v0.7.md §3.6。
 * - 无 UserDashboardPref 记录时，GET /dashboard/layout 按角色返回此默认布局。
 * - 布局格式与 react-grid-layout 一致（i/x/y/w/h，可选 minW/minH）。
 * - 纯数据模块，无 IO，后端路由与前端组件共享，避免漂移。
 */
import type { Role } from "./types";

/**
 * react-grid-layout 单个布局项。
 * i = widget id（与 GET /dashboard/widgets/:widgetId 的 widgetId 对应）。
 * x/y 为网格坐标，w/h 为占位宽高（单位 = 1 格）。
 * minW/minH 为最小尺寸约束（可选，RGL 编辑模式用）。
 */
export interface RGLItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

/**
 * 按角色的默认仪表盘布局。
 * owner/admin 偏分析视图（燃尽图 + 团队负载），member 偏执行视图（我的任务 + 本周截止），
 * viewer 最精简（统计 + 最近活动）。
 */
export const DEFAULT_LAYOUTS: Record<Role, RGLItem[]> = {
  owner: [
    { i: "task-stats", x: 0, y: 0, w: 1, h: 1 },
    { i: "burndown", x: 1, y: 0, w: 3, h: 2 },
    { i: "team-load", x: 0, y: 1, w: 2, h: 2 },
    { i: "recent-activity", x: 2, y: 2, w: 2, h: 1 },
  ],
  admin: [
    { i: "task-stats", x: 0, y: 0, w: 1, h: 1 },
    { i: "burndown", x: 1, y: 0, w: 3, h: 2 },
    { i: "decision-actions", x: 0, y: 1, w: 2, h: 1 },
    { i: "recent-activity", x: 2, y: 2, w: 2, h: 1 },
  ],
  member: [
    { i: "task-stats", x: 0, y: 0, w: 1, h: 1 },
    { i: "my-tasks", x: 1, y: 0, w: 2, h: 2 },
    { i: "due-this-week", x: 0, y: 1, w: 2, h: 1 },
    { i: "priority-dist", x: 3, y: 0, w: 1, h: 1 },
  ],
  viewer: [
    { i: "task-stats", x: 0, y: 0, w: 1, h: 1 },
    { i: "recent-activity", x: 1, y: 0, w: 2, h: 1 },
  ],
};

/**
 * 取指定角色的默认布局。角色非法时回退 viewer（最保守）。
 */
export function getDefaultLayout(role: string): RGLItem[] {
  return DEFAULT_LAYOUTS[role as Role] ?? DEFAULT_LAYOUTS.viewer;
}

/**
 * 类型守卫：判断 Prisma Json 值是否为合法的 RGLItem[]。
 * 用于防御历史脏数据（旧记录可能格式不一致）。
 */
export function isRGLLayout(value: unknown): value is RGLItem[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).i === "string" &&
      typeof (item as Record<string, unknown>).x === "number" &&
      typeof (item as Record<string, unknown>).y === "number" &&
      typeof (item as Record<string, unknown>).w === "number" &&
      typeof (item as Record<string, unknown>).h === "number",
  );
}