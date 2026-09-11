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
  // F7: 4列→12列细粒度网格，w×3、x×3、h 按 rowHeight 80→60 调整（×0.75 取整）
  owner: [
    { i: "task-stats", x: 0, y: 0, w: 3, h: 1 },
    { i: "burndown", x: 3, y: 0, w: 9, h: 3 },
    { i: "team-load", x: 0, y: 1, w: 6, h: 3 },
    { i: "recent-activity", x: 6, y: 2, w: 6, h: 2 },
  ],
  admin: [
    { i: "task-stats", x: 0, y: 0, w: 3, h: 1 },
    { i: "burndown", x: 3, y: 0, w: 9, h: 3 },
    { i: "decision-actions", x: 0, y: 1, w: 6, h: 2 },
    { i: "recent-activity", x: 6, y: 2, w: 6, h: 2 },
  ],
  member: [
    { i: "task-stats", x: 0, y: 0, w: 3, h: 1 },
    { i: "my-tasks", x: 3, y: 0, w: 6, h: 3 },
    { i: "due-this-week", x: 0, y: 1, w: 6, h: 2 },
    { i: "priority-dist", x: 9, y: 0, w: 3, h: 1 },
  ],
  viewer: [
    { i: "task-stats", x: 0, y: 0, w: 3, h: 1 },
    { i: "recent-activity", x: 3, y: 0, w: 6, h: 2 },
  ],
};

/**
 * F7 尺寸循环预设：双击 Widget 标题栏时按 S→M→L→XL→S 循环切换。
 * w/h 为 12 列网格下的占位宽高（单位 = 1 格）。
 */
export const SIZE_PRESETS: ReadonlyArray<{ label: string; w: number; h: number }> = [
  { label: "S", w: 2, h: 2 },
  { label: "M", w: 4, h: 3 },
  { label: "L", w: 6, h: 4 },
  { label: "XL", w: 8, h: 5 },
];

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
/**
 * F3 Widget 仪表盘偏好持久化结构（layout JSON 字段复合格式）。
 *
 * 为支持 widgetConfigs 持久化且不修改 Prisma schema，layout JSON 字段
 * 存储此复合对象。向后兼容：旧记录的 layout 字段为 RGLItem[] 数组，
 * 读取时 isDashboardPrefData 返回 false，回退为 { items, widgetConfigs: {} }。
 *
 * - items：react-grid-layout 布局项数组
 * - widgetConfigs：每个 widget 的配置参数，key = widgetId，value = 配置对象
 */
export interface DashboardPrefData {
  items: RGLItem[];
  widgetConfigs?: Record<string, Record<string, unknown>>;
}

/**
 * 类型守卫：判断 Prisma Json 值是否为 DashboardPrefData 复合格式。
 * 用于区分新格式（对象）与旧格式（RGLItem[] 数组）。
 */
export function isDashboardPrefData(value: unknown): value is DashboardPrefData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.items) && isRGLLayout(obj.items);
}

/**
 * 将任意 Prisma Json 值规范化为 DashboardPrefData。
 * - 旧格式 RGLItem[] → { items, widgetConfigs: {} }
 * - 新格式 DashboardPrefData → 原样返回（widgetConfigs 缺失补 {}）
 * - 非法值 → { items: [], widgetConfigs: {} }
 */
export function normalizePrefData(value: unknown): DashboardPrefData {
  if (isDashboardPrefData(value)) {
    return { items: value.items, widgetConfigs: value.widgetConfigs ?? {} };
  }
  if (isRGLLayout(value)) {
    return { items: value, widgetConfigs: {} };
  }
  return { items: [], widgetConfigs: {} };
}