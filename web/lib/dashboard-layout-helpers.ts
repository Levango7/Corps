import { z } from "zod";
import {
  normalizePrefData,
  type DashboardPrefData,
  type RGLItem,
} from "./default-layouts";

/**
 * F3 Widget 仪表盘 — 布局偏好 API 共享 helpers。
 *
 * 供 layout/route.ts、layout/export/route.ts、layout/import/route.ts 复用，
 * 避免从 route.ts 导出非 HTTP 方法（Next.js App Router 约定）。
 */

/** RGL 布局项校验 schema */
export const layoutItemSchema = z.object({
  i: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  minW: z.number().int().min(1).optional(),
  minH: z.number().int().min(1).optional(),
});

/** widgetConfigs 校验：widgetId → 配置对象（任意字符串键值对） */
export const widgetConfigsSchema = z
  .record(z.string(), z.record(z.string(), z.unknown()))
  .optional();

/** PUT /layout body schema */
export const putLayoutSchema = z.object({
  layout: z.array(layoutItemSchema).min(1),
  /** 可选响应式断点标签（对齐 openapi DashboardLayoutUpdateRequest；当前未持久化，仅回显） */
  breakpoint: z.string().optional(),
  /** 可选 Widget 配置参数：widgetId → 配置对象 */
  widgetConfigs: widgetConfigsSchema,
});

/** POST /layout/import body schema */
export const importLayoutSchema = z.object({
  layout: z.array(layoutItemSchema).min(1),
  widgetConfigs: widgetConfigsSchema,
  /** 可选模板名称（仅用于日志/审计，不持久化） */
  name: z.string().max(100).optional(),
});

/**
 * 从 Prisma layout 字段提取布局与 widgetConfigs。
 * 兼容旧数组格式与新的 DashboardPrefData 复合格式。
 */
export function extractPref(layoutField: unknown): {
  layout: RGLItem[];
  widgetConfigs: Record<string, Record<string, unknown>>;
} {
  const data = normalizePrefData(layoutField);
  return {
    layout: data.items,
    widgetConfigs: data.widgetConfigs ?? {},
  };
}

/** 构造复合持久化结构 */
export function buildPrefData(
  layout: RGLItem[],
  widgetConfigs?: Record<string, Record<string, unknown>>,
): DashboardPrefData {
  return { items: layout, widgetConfigs: widgetConfigs ?? {} };
}