/**
 * 权限矩阵页（/w/[wid]/settings/permissions）的数据契约层。
 *
 * 页面内部用「布尔矩阵」：matrix[role][module][action] = true/false；
 * 服务端 GET /api/v1/workspaces/{wid}/permissions 返回的是
 *   { roles: { [role]: { [module]: Action[] } }, modules, total, hasMore }
 * 且模块集合是 14 个（含 whiteboards/timetrack/announcements/contacts/databases/
 * databaseRecords），页面只展示其中 8 列。
 *
 * 两者形状不同，必须显式适配（见 toPermissionMatrix）。此前页面把响应体直接当
 * 矩阵使用，`matrix["owner"]` 为 undefined，`matrixEqual` 里读 `[module]` 立刻抛
 * `TypeError: Cannot read properties of undefined (reading 'tasks')`，整页进路由
 * 级错误边界。
 *
 * 写回方向也不对称：PATCH 只接受**单格** { role, module, actions }，且只允许
 * member/viewer（owner/admin 由 zod 直接 400）。故写回需要 toPermissionPatches
 * 把矩阵差异拆成逐格补丁。
 *
 * 本模块刻意不 import `@/lib/permissions`（后者运行时 import "next/server"，
 * 会把服务端代码拖进客户端 bundle）；两处的 Action 语义一致但各自声明。
 */

import type { Role } from "./types";

// ─── 页面侧类型与常量 ───────────────────────────────────────

/** 模块 key：页面展示的 8 列（服务端 MODULES 的子集，顺序与表头一致）。 */
export const MODULES = [
  "tasks",
  "decisions",
  "documents",
  "messages",
  "members",
  "billing",
  "analytics",
  "settings",
] as const;

export type ModuleKey = (typeof MODULES)[number];

/** 操作 key：R/C/U/D，与服务端 Action 一一对应（同名字面量）。 */
export const ACTIONS = ["read", "create", "update", "delete"] as const;

export type ActionKey = (typeof ACTIONS)[number];

/** 单格权限：4 个布尔值。 */
export type PermissionCell = Record<ActionKey, boolean>;

/** 权限矩阵：matrix[role][module] = PermissionCell。 */
export type PermissionMatrix = Record<Role, Record<ModuleKey, PermissionCell>>;

/** 角色顺序（表格行顺序）。 */
export const ROLES: readonly Role[] = ["owner", "admin", "member", "viewer"];

/**
 * 服务端允许写覆盖的角色。
 * 依据：app/api/v1/workspaces/[wid]/permissions/route.ts 的 patchSchema
 * `role: z.enum(["member", "viewer"])`，owner/admin 覆盖会被 400 拒绝。
 */
export const OVERRIDABLE_ROLES = ["member", "viewer"] as const;

export type OverridableRole = (typeof OVERRIDABLE_ROLES)[number];

/** 该角色是否可写覆盖（member/viewer）。 */
export function isOverridable(role: Role): role is OverridableRole {
  return (OVERRIDABLE_ROLES as readonly Role[]).includes(role);
}

// ─── 默认矩阵 ───────────────────────────────────────────────

/** Owner/Admin 默认拥有全部权限。 */
const FULL_CELL: PermissionCell = { read: true, create: true, update: true, delete: true };

/** Viewer 默认仅读。 */
const READ_ONLY_CELL: PermissionCell = { read: true, create: false, update: false, delete: false };

/** 生成默认权限矩阵（未配置 / 响应缺项时兜底）。 */
export function defaultMatrix(): PermissionMatrix {
  const makeRoleRow = (cell: PermissionCell): Record<ModuleKey, PermissionCell> =>
    MODULES.reduce(
      (acc, m) => {
        acc[m] = { ...cell };
        return acc;
      },
      {} as Record<ModuleKey, PermissionCell>,
    );

  return {
    owner: makeRoleRow(FULL_CELL),
    admin: makeRoleRow(FULL_CELL),
    member: {
      ...makeRoleRow({ read: true, create: true, update: true, delete: false }),
      // member 对 members/billing/analytics/settings 仅读
      members: { ...READ_ONLY_CELL },
      billing: { ...READ_ONLY_CELL },
      analytics: { ...READ_ONLY_CELL },
      settings: { ...READ_ONLY_CELL },
    },
    viewer: makeRoleRow(READ_ONLY_CELL),
  };
}

/** 深拷贝矩阵（避免引用共享导致状态错乱）。 */
export function cloneMatrix(m: PermissionMatrix): PermissionMatrix {
  const out = {} as PermissionMatrix;
  for (const r of ROLES) {
    out[r] = {} as Record<ModuleKey, PermissionCell>;
    for (const mod of MODULES) {
      out[r][mod] = { ...m[r][mod] };
    }
  }
  return out;
}

// ─── 比较 ───────────────────────────────────────────────────

/** 单格比较。 */
export function cellEqual(a: PermissionCell, b: PermissionCell): boolean {
  return ACTIONS.every((act) => a[act] === b[act]);
}

/**
 * 矩阵相等比较（用于判断 dirty）。
 *
 * 纵深防御：即便传入的是不完整/畸形矩阵（例如响应形状变更、旧缓存），也只返回
 * false 而**不抛**——`dirty` 位于 useMemo 中，抛异常会直接击穿整页。
 * 缺失格一律视为「不相等」，宁可让保存按钮可点，也不静默隐藏差异。
 */
export function matrixEqual(
  a: PermissionMatrix | null | undefined,
  b: PermissionMatrix | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  for (const r of ROLES) {
    for (const mod of MODULES) {
      const ca = a[r]?.[mod];
      const cb = b[r]?.[mod];
      if (!ca || !cb) return false;
      if (!cellEqual(ca, cb)) return false;
    }
  }
  return true;
}

// ─── 服务端 → 页面（读） ───────────────────────────────────

/** 非数组的普通对象判定。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 服务端 GET 响应体（api() 已解包 data）→ 页面布尔矩阵。
 *
 * 形状（route.ts:104-112）：
 *   { roles: { [role]: { [module]: Action[] } }, modules: string[], total, hasMore }
 *
 * 规则：
 *  - 解包 `data.roles`；roles 缺失/非对象 → 整张默认矩阵；
 *  - 单个 role 缺失、或某 module 缺失/非数组 → 用 defaultMatrix() 对应项兜底，
 *    保证返回值**永远是完整矩阵**（8 模块 × 4 角色 × 4 动作）；
 *  - module 值是空数组是**合法语义**（明确无任何动作，如 admin.billing = []），
 *    此时四格全 false，不回落默认值。
 */
export function toPermissionMatrix(data: unknown): PermissionMatrix {
  const matrix = defaultMatrix();
  if (!isRecord(data)) return matrix;

  const roles = data.roles;
  if (!isRecord(roles)) return matrix;

  for (const role of ROLES) {
    const row = roles[role];
    if (!isRecord(row)) continue;
    for (const mod of MODULES) {
      const actions = row[mod];
      if (!Array.isArray(actions)) continue;
      const cell = matrix[role][mod];
      for (const act of ACTIONS) cell[act] = actions.includes(act);
    }
  }
  return matrix;
}

// ─── 页面 → 服务端（写） ───────────────────────────────────

/** PATCH /permissions 的单格请求体（与 route.ts 的 patchSchema 对齐）。 */
export interface PermissionPatch {
  role: OverridableRole;
  module: ModuleKey;
  /** 该格允许的动作名数组（服务端按并集合并默认值，故顺序无关） */
  actions: ActionKey[];
}

/**
 * 布尔矩阵差异 → 逐格 PATCH 请求体。
 *
 * 只产出 member/viewer 的差异：owner/admin 行服务端不可覆盖（zod 400），
 * 页面也不再允许编辑这两行。
 */
export function toPermissionPatches(
  next: PermissionMatrix,
  original: PermissionMatrix,
): PermissionPatch[] {
  const patches: PermissionPatch[] = [];
  for (const role of OVERRIDABLE_ROLES) {
    for (const mod of MODULES) {
      const after = next[role]?.[mod];
      const before = original[role]?.[mod];
      if (!after || !before || cellEqual(after, before)) continue;
      patches.push({
        role,
        module: mod,
        actions: ACTIONS.filter((act) => after[act]),
      });
    }
  }
  return patches;
}

/**
 * 布尔矩阵 → 服务端 GET 的形状（{ [role]: { [module]: Action[] } }）。
 *
 * 仅用于契约往返验证（测试）与将来可能的整表提交；生产写回走
 * toPermissionPatches 的单格 PATCH。只输出页面展示的 8 个模块。
 */
export function toServerRoles(
  matrix: PermissionMatrix,
): Record<Role, Record<ModuleKey, ActionKey[]>> {
  const out = {} as Record<Role, Record<ModuleKey, ActionKey[]>>;
  for (const role of ROLES) {
    out[role] = {} as Record<ModuleKey, ActionKey[]>;
    for (const mod of MODULES) {
      const cell = matrix[role]?.[mod];
      out[role][mod] = cell ? ACTIONS.filter((act) => cell[act]) : [];
    }
  }
  return out;
}
