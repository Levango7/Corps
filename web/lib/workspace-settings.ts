import { z } from "zod";

import { OPTIONAL_MODULE_IDS } from "@/lib/modules/registry";

/**
 * 工作区级轻量配置（`workspaces.settings`）的读写边界（P1-B2）。
 *
 * 为什么 JSON 列还需要一个"访问层"：数据库不受类型约束，任何写入路径都可能塞进
 * 任意键。这里把**已知子树**用 zod 收口（未知键原样保留，供将来扩展），
 * 并且只接受**可选模块 id**——不接受首屏模块或已删除模块的 id，
 * 避免一个手滑的 PATCH 把"概览"塞进可选列表、或者让侧栏出现不存在的入口。
 *
 * 空配置 `{}` 的语义 = 所有可选模块都在「更多」里，与 P1-B1 的默认呈现一致。
 */

const optionalIds = new Set(OPTIONAL_MODULE_IDS);

const sidebarSchema = z.object({
  enabledModules: z.array(z.string()).optional(),
});

const settingsSchema = z.object({
  sidebar: sidebarSchema.optional(),
});

export interface SidebarSettings {
  /** 已启用的可选模块 id（去重、只保留合法 id、保持输入顺序） */
  enabledModules: string[];
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/** 从任意 JSON 里读出侧栏设置；脏数据一律降级为"全部未启用"。 */
export function readSidebarSettings(raw: unknown): SidebarSettings {
  const parsed = settingsSchema.safeParse(raw ?? {});
  if (!parsed.success) return { enabledModules: [] };
  const seen = new Set<string>();
  const enabledModules = (parsed.data.sidebar?.enabledModules ?? []).filter((id) => {
    if (!optionalIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { enabledModules };
}

/**
 * 把新的启用列表合并回 settings（保留其它未知键，不做整对象覆盖）。
 * 非法 id 静默丢弃——调用方应先做一次校验并给用户明确报错；
 * 这里是最后一道兜底，保证落库的一定是合法口径。
 */
export function withSidebarSettings(
  raw: unknown,
  enabledModules: readonly string[],
): Record<string, unknown> {
  const base = asRecord(raw);
  const sidebar = asRecord(base.sidebar);
  const seen = new Set<string>();
  const next = enabledModules.filter((id) => {
    if (!optionalIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { ...base, sidebar: { ...sidebar, enabledModules: next } };
}

/** 写入前的显式校验：返回非法 id 列表（空数组 = 全部合法）。 */
export function invalidOptionalModuleIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !optionalIds.has(id));
}
