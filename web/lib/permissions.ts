/**
 * F2 权限检查中间件：Viewer 角色 + 模块权限矩阵
 *
 * 设计要点：
 *  - 默认权限矩阵为代码内常量（零 DB 查询），按角色×模块定义允许的动作集
 *    （c/r/u/d 单字符代码，与 actions 字符串对照）。
 *  - owner 短路：永远返回 true，不查权限表。
 *  - admin 使用默认矩阵（不可被 MemberPermission 覆盖）。
 *  - member/viewer 先查默认矩阵，再查 ctx.permissions Map 中的自定义覆盖
 *    （Map 由 getWorkspaceContext 一次性加载该工作区该角色的所有覆盖，
 *     key 格式 `${role}:${module}`，value 为单字符动作代码串如 "cr"）。
 *  - 合并语义：默认 ∪ 覆盖（覆盖只能放宽不能收紧）。若需收紧，在路由层
 *    用 requirePermission 做更严格的 action 检查即可。
 *
 * 动作代码映射：c=create r=read u=update d=delete
 *
 * 来源：F2 任务 156
 */
import { NextResponse, type NextRequest } from "next/server";
import { apiMsg } from "./api-messages";

/** 权限上下文：getWorkspaceContext 返回值的子集（payload 可选）。 */
export interface PermissionContext {
  member: { role: string; workspaceId: string };
  permissions?: Map<string, string>;
}

/** 动作类型 */
export type Action = "create" | "read" | "update" | "delete";

/** 模块列表 */
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

/** 角色列表 */
export const ROLES = ["owner", "admin", "member", "viewer"] as const;

/** 动作 → 单字符代码 */
const ACTION_CODE: Record<Action, string> = {
  create: "c",
  read: "r",
  update: "u",
  delete: "d",
};

/** 单字符代码 → 动作名（用于 getMergedPermissions 输出） */
const CODE_ACTION: Record<string, Action> = {
  c: "create",
  r: "read",
  u: "update",
  d: "delete",
};

/**
 * 默认权限矩阵（代码内常量，零 DB 查询）。
 * 值为允许的动作单字符代码串，如 "crud" 表示全部允许，"" 表示全部禁止。
 */
const DEFAULT_PERMISSIONS: Record<string, Record<string, string>> = {
  owner: {
    tasks: "crud",
    decisions: "crud",
    documents: "crud",
    messages: "crud",
    members: "crud",
    billing: "crud",
    analytics: "r",
    settings: "crud",
  },
  admin: {
    tasks: "crud",
    decisions: "crud",
    documents: "crud",
    messages: "crud",
    members: "cr",
    billing: "",
    analytics: "r",
    settings: "r",
  },
  member: {
    tasks: "crud",
    decisions: "cr",
    documents: "cr",
    messages: "crud",
    members: "",
    billing: "",
    analytics: "",
    settings: "",
  },
  viewer: {
    tasks: "r",
    decisions: "r",
    documents: "r",
    messages: "r",
    members: "",
    billing: "",
    analytics: "",
    settings: "",
  },
};

/**
 * 权限检查核心：判断指定角色在给定上下文下是否对模块拥有该动作权限。
 *
 * @returns true 允许，false 拒绝
 */
export async function checkPermission(
  ctx: PermissionContext,
  module: string,
  action: Action,
): Promise<boolean> {
  const role = ctx.member.role;
  // Owner 短路：永远放行
  if (role === "owner") return true;

  const actionCode = ACTION_CODE[action];

  // 1. 查默认权限矩阵
  const defaultActions = DEFAULT_PERMISSIONS[role]?.[module] ?? "";
  if (defaultActions.includes(actionCode)) return true;

  // 2. 查自定义覆盖（从 ctx.permissions Map 查内存，key: `${role}:${module}`）
  //    仅 member/viewer 有覆盖（auth.ts 加载时保证）；admin 走默认矩阵。
  const override = ctx.permissions?.get(`${role}:${module}`);
  return override?.includes(actionCode) ?? false;
}

/**
 * 便捷函数：检查权限，不通过则返回 403 NextResponse，通过则返回 null。
 *
 * 用法：
 *   const denied = await requirePermission(ctx, "billing", "update", req);
 *   if (denied) return denied;
 */
export async function requirePermission(
  ctx: PermissionContext,
  module: string,
  action: Action,
  req: NextRequest,
): Promise<NextResponse | null> {
  const ok = await checkPermission(ctx, module, action);
  if (!ok) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "forbidden"), data: null },
      { status: 403 },
    );
  }
  return null;
}

/**
 * 获取合并后的权限矩阵（默认 ∪ 覆盖），供 GET /permissions 返回。
 *
 * @returns { [module]: ["create","read",...] } 动作名数组
 */
export function getMergedPermissions(
  role: string,
  overrides: Map<string, string> | undefined,
): Record<string, Action[]> {
  const result: Record<string, Action[]> = {};
  for (const mod of MODULES) {
    const def = DEFAULT_PERMISSIONS[role]?.[mod] ?? "";
    const ovr = overrides?.get(`${role}:${mod}`) ?? "";
    // 合并：默认 + 覆盖（并集，去重）
    const merged = new Set([...def, ...ovr]);
    result[mod] = [...merged]
      .map((c) => CODE_ACTION[c])
      .filter((a): a is Action => a !== undefined);
  }
  return result;
}

/**
 * 获取单个角色的默认权限矩阵（无覆盖），供前端预览/兜底。
 */
export function getDefaultPermissions(role: string): Record<string, Action[]> {
  const result: Record<string, Action[]> = {};
  for (const mod of MODULES) {
    const def = DEFAULT_PERMISSIONS[role]?.[mod] ?? "";
    result[mod] = [...def]
      .map((c) => CODE_ACTION[c])
      .filter((a): a is Action => a !== undefined);
  }
  return result;
}