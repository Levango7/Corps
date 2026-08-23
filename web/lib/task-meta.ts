/**
 * 任务元数据常量 —— 单一编辑源。
 *
 * STATUS_META / STATUS_LABELS / PRIORITY_LABELS / PRIORITY_BAR_COLORS /
 * PRIORITY_BADGE_STYLES / STATUS_BADGE_STYLES / COLUMNS / PRIORITY_ORDER
 * 曾在 board、my-tasks、home、task 详情页各自重复定义，且出现色值漂移
 * （review 在 board 用 var(--warn)，在 task 详情页用 var(--status-warn) 不存在）。
 *
 * 统一从此处 import，确保跨页一致。所有色值走 var(--token)，无裸 hex。
 */

import {
  Circle,
  CircleDot,
  CheckCircle2,
  ShieldCheck,
  Shield,
  User as UserIcon,
  type LucideIcon,
} from "lucide-react";
import type { Status, Priority, Role } from "./types";

/** 状态元数据：图标 + 中文标签 + 主色 token。 */
export const STATUS_META: Record<Status, { label: string; icon: LucideIcon; color: string }> = {
  todo: { label: "待办", icon: Circle, color: "var(--status-todo)" },
  in_progress: { label: "进行中", icon: CircleDot, color: "var(--status-doing)" },
  review: { label: "评审", icon: CircleDot, color: "var(--warn)" },
  done: { label: "已完成", icon: CheckCircle2, color: "var(--status-done)" },
};

/** 状态中文标签（无图标场景） */
export const STATUS_LABELS: Record<Status, string> = {
  todo: "待办",
  in_progress: "进行中",
  review: "评审",
  done: "已完成",
};

/** 优先级中文标签 */
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

/** 优先级主色 token（用于图标/色条） */
export const PRIORITY_COLORS: Record<Priority, string> = {
  low: "var(--meta)",
  medium: "var(--muted)",
  high: "var(--warn)",
  urgent: "var(--danger)",
};

/**
 * 优先级左侧色条：low 透明（占位保持卡片左缘对齐），其余用语义色。
 * board 页用此形态（3px 色条）。
 */
export const PRIORITY_BAR_COLORS: Record<Priority, string> = {
  low: "transparent",
  medium: "var(--muted)",
  high: "var(--warn)",
  urgent: "var(--danger)",
};

/** 优先级排序权重：urgent > high > medium > low */
export const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * 状态徽章样式：用 color-mix 替代 `${color}20` alpha 拼接。
 * var(--token) 不能与十六进制透明度后缀组合，color-mix 是 W3C 标准方案，
 * 且能随主题切换自动重算。
 */
export const STATUS_BADGE_STYLES: Record<Status, { background: string; color: string }> = {
  todo: {
    background: "color-mix(in srgb, var(--status-todo) 12%, transparent)",
    color: "var(--status-todo)",
  },
  in_progress: {
    background: "color-mix(in srgb, var(--status-doing) 12%, transparent)",
    color: "var(--status-doing)",
  },
  review: {
    background: "color-mix(in srgb, var(--warn) 14%, transparent)",
    color: "var(--warn)",
  },
  done: {
    background: "color-mix(in srgb, var(--status-done) 12%, transparent)",
    color: "var(--status-done)",
  },
};

/**
 * 优先级徽章样式：用 color-mix 替代 alpha 拼接。
 * 复用语义色映射，避免引入不存在的 --priority-* token。
 */
export const PRIORITY_BADGE_STYLES: Record<Priority, { background: string; color: string }> = {
  low: { background: "color-mix(in srgb, var(--meta) 12%, transparent)", color: "var(--meta)" },
  medium: {
    background: "color-mix(in srgb, var(--muted) 12%, transparent)",
    color: "var(--muted)",
  },
  high: {
    background: "color-mix(in srgb, var(--warn) 14%, transparent)",
    color: "var(--warn)",
  },
  urgent: {
    background: "color-mix(in srgb, var(--danger) 12%, transparent)",
    color: "var(--danger)",
  },
};

/** 看板列定义：顺序即渲染顺序。 */
export const COLUMNS: { id: Status; title: string; color: string }[] = [
  { id: "todo", title: "待办", color: "var(--status-todo)" },
  { id: "in_progress", title: "进行中", color: "var(--status-doing)" },
  { id: "review", title: "评审", color: "var(--warn)" },
  { id: "done", title: "已完成", color: "var(--status-done)" },
];

/** 状态分组（与 COLUMNS 同源，my-tasks 页用） */
export const STATUS_GROUPS = COLUMNS;

/** 顶部状态筛选项：比分组多一个「全部」。 */
export const STATUS_FILTERS: {
  id: "all" | Status;
  title: string;
  color?: string;
}[] = [
  { id: "all", title: "全部" },
  { id: "todo", title: "待办", color: "var(--status-todo)" },
  { id: "in_progress", title: "进行中", color: "var(--status-doing)" },
  { id: "review", title: "评审", color: "var(--warn)" },
  { id: "done", title: "已完成", color: "var(--status-done)" },
];

/** 概览页统计卡：进行中 = in_progress + review 合并计数。 */
export const STAT_CARDS: {
  key: "todo" | "doing" | "done";
  label: string;
  icon: LucideIcon;
  color: string;
  match: (s: Status) => boolean;
}[] = [
  {
    key: "todo",
    label: "待办",
    icon: Circle,
    color: "var(--status-todo)",
    match: (s) => s === "todo",
  },
  {
    key: "doing",
    label: "进行中",
    icon: CircleDot,
    color: "var(--status-doing)",
    match: (s) => s === "in_progress" || s === "review",
  },
  {
    key: "done",
    label: "已完成",
    icon: CheckCircle2,
    color: "var(--status-done)",
    match: (s) => s === "done",
  },
];

/** 角色元数据：图标 + 中文标签。 */
export const ROLE_META: Record<Role, { label: string; icon: LucideIcon }> = {
  owner: { label: "拥有者", icon: ShieldCheck },
  admin: { label: "管理员", icon: Shield },
  member: { label: "成员", icon: UserIcon },
};
