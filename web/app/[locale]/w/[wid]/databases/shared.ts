"use client";

/**
 * 多维表格 · 页面层共享模块（API DTO 形状 + Prisma 类型适配 + 角色判定）
 *
 * 为什么需要这一层：
 *  1. `DatabaseEditor` 的 props 按 `@prisma/client` 的模型类型声明，而
 *     `/api/v1/.../databases*` 返回的是 JSON：DateTime 被序列化成 string，
 *     Json 列（options / data / config）在 JSON 侧只能是 unknown。
 *     这里做**最小适配**（重建标量字段 + 收窄 Json 列），不改编辑器本体。
 *  2. 列表页与详情页都要判断"当前用户能不能写"——POST/PATCH/DELETE
 *     database 与 fields/views 在服务端都是 owner/admin 才放行，
 *     口径收敛到 `canManageDatabases()` 一处。
 */

import type { Database, DatabaseField, DatabaseRecord, DatabaseView } from "@prisma/client";
import { api, apiList } from "@/lib/api";
import type { Role } from "@/lib/types";

// ─── API DTO（与 route.ts 实际返回字段对齐）──────────────────────

/** `GET /databases` 列表项 / `POST /databases` 响应 */
export interface DatabaseDto {
  id: string;
  workspaceId: string;
  spaceId: string | null;
  folderId: string | null;
  title: string;
  icon: string;
  emoji: string | null;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** 仅 `GET /databases/{dbid}` 会带（include fields/views） */
  fields?: DatabaseFieldDto[];
  views?: DatabaseViewDto[];
}

/** 字段（列定义） */
export interface DatabaseFieldDto {
  id: string;
  databaseId: string;
  name: string;
  /** text / number / select / multiselect / date / checkbox / user / url / email */
  type: string;
  options: unknown;
  sortOrder: number;
  createdAt: string;
}

/** 记录（数据行），data 为 `{ [fieldId]: value }` */
export interface DatabaseRecordDto {
  id: string;
  databaseId: string;
  data: unknown;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 视图 */
export interface DatabaseViewDto {
  id: string;
  databaseId: string;
  name: string;
  /** table / board / gantt / calendar */
  type: string;
  /** 视图配置：filters / filterLogic / sorts / groupFieldId ... */
  config: unknown;
  sortOrder: number;
  createdAt: string;
}

// ─── DTO → @prisma/client 模型 ─────────────────────────────────

/**
 * 把 API 的 JSON 记录还原成 `DatabaseEditor` 要的 Prisma 模型形状。
 *
 * Json 列（options/data/config）用索引访问类型收窄，避免在本模块引入
 * `Prisma` 运行时命名空间（`@prisma/client` 的运行时代码不能进浏览器包）。
 */
export function toDatabaseModel(dto: DatabaseDto): Database {
  return {
    id: dto.id,
    workspaceId: dto.workspaceId,
    spaceId: dto.spaceId,
    folderId: dto.folderId,
    title: dto.title,
    icon: dto.icon,
    emoji: dto.emoji,
    description: dto.description,
    sortOrder: dto.sortOrder,
    createdAt: new Date(dto.createdAt),
    updatedAt: new Date(dto.updatedAt),
  };
}

export function toFieldModels(dtos: DatabaseFieldDto[] | undefined): DatabaseField[] {
  return (dtos ?? []).map((f) => ({
    id: f.id,
    databaseId: f.databaseId,
    name: f.name,
    type: f.type,
    options: f.options as DatabaseField["options"],
    sortOrder: f.sortOrder,
    createdAt: new Date(f.createdAt),
  }));
}

export function toRecordModels(dtos: DatabaseRecordDto[] | undefined): DatabaseRecord[] {
  return (dtos ?? []).map((r) => ({
    id: r.id,
    databaseId: r.databaseId,
    data: r.data as DatabaseRecord["data"],
    sortOrder: r.sortOrder,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  }));
}

export function toViewModels(dtos: DatabaseViewDto[] | undefined): DatabaseView[] {
  return (dtos ?? []).map((v) => ({
    id: v.id,
    databaseId: v.databaseId,
    name: v.name,
    type: v.type,
    config: v.config as DatabaseView["config"],
    sortOrder: v.sortOrder,
    createdAt: new Date(v.createdAt),
  }));
}

// ─── 记录 data 读写辅助 ────────────────────────────────────────

/** record.data 安全取对象（与 TableView 的 getRecordData 同口径） */
export function recordDataAsObject(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

// ─── 权限 ──────────────────────────────────────────────────────

/**
 * 取当前用户在 wid 下的角色。
 *
 * 与 `components/im/ConversationSettings.tsx` 同一套做法：
 * `/users/me` 拿自己的 id，再从 `/workspaces/{wid}/members` 里找该成员的 role。
 * 任一步失败都返回 null（调用方按只读降级，不炸页面）。
 */
export async function fetchMyWorkspaceRole(wid: string): Promise<Role | null> {
  try {
    const [me, members] = await Promise.all([
      api<{ id: string }>("/api/v1/users/me").catch(() => ({ id: "" })),
      apiList<{ userId: string; role: Role }>(`/api/v1/workspaces/${wid}/members`),
    ]);
    if (!me.id) return null;
    return members.find((m) => m.userId === me.id)?.role ?? null;
  } catch {
    return null;
  }
}

/**
 * 能否管理多维表格（建/改/删 database、字段、视图）。
 * 对齐服务端 `["owner","admin"].includes(ctx.member.role)` 的判断口径。
 * 记录（records）的 POST/PATCH 服务端**没有**角色校验，member 与 viewer 都放行。
 */
export function canManageDatabases(role: Role | null): boolean {
  return role === "owner" || role === "admin";
}
