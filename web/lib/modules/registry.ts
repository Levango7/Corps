/**
 * 工作区模块注册表 —— **分组、路由、权限的唯一事实源**。
 *
 * 背景（2026-10-20 产品方案 §5）：侧栏有 31 个静态入口，高频与一年点一次的模块
 * 在首屏同等显眼；用户拍板「功能不做减法、做整合」。先把「有哪些模块、在哪个组、
 * 谁看不见」收进这张表，布局 / Cmd+K / 设置页 / 计费矩阵都从这里读，避免第二份清单漂移。
 *
 * **分阶段**：本阶段（P1-A）只做单一事实源，注册表顺序与改造前侧栏逐项一致、
 * 不改任何呈现（侧栏像素不变，视觉基线无需更新）；默认可见性（核心 6 + 可选模块
 * 收进「更多」）在 P1-B 与视觉基线一起改。
 *
 * 纯数据 + 纯函数：不 import React，可被服务端组件、单测直接消费。
 * 图标只存键名（见 ./icons.ts），由渲染层映射成组件。
 */

import type { ModuleIconName } from "./icons";

/** 导航分组 id（顺序即侧栏顺序） */
export type ModuleGroupId = "core" | "collaboration" | "knowledge" | "planning" | "ai" | "admin";

export interface ModuleGroup {
  id: ModuleGroupId;
  /** i18n 键（nav 命名空间）；核心组无标题 */
  labelKey: string | null;
}

export interface WorkspaceModule {
  /** 稳定 id，不要改：设置页、埋点、默认可见性都按它索引 */
  id: string;
  /** 相对 /w/{wid} 的路径；根路径用 "" */
  path: string;
  /** i18n 键（nav 命名空间） */
  labelKey: string;
  icon: ModuleIconName;
  group: ModuleGroupId;
  /** true = viewer 角色隐藏（与「管理」组同义：只读成员不可管理工作区） */
  viewerHidden?: boolean;
  /** 仅概览页用 exact 匹配 */
  exact?: boolean;
}

export const MODULE_GROUPS: readonly ModuleGroup[] = [
  { id: "core", labelKey: null },
  { id: "collaboration", labelKey: "menu.groupCollaboration" },
  { id: "knowledge", labelKey: "menu.groupKnowledge" },
  { id: "planning", labelKey: "menu.groupPlanning" },
  { id: "ai", labelKey: "menu.groupAI" },
  { id: "admin", labelKey: "menu.admin" },
];

/**
 * 31 个静态模块（与改造前侧栏一一对应；收藏是动态项，不在表内）。
 *
 * **顺序即侧栏顺序**：本阶段必须与改造前逐项一致（见单测的组内顺序快照），
 * 否则 dashboard 的视觉基线会因为侧栏像素变化而红。
 */
export const WORKSPACE_MODULES: readonly WorkspaceModule[] = [
  // ── 核心（产品楔子：讨论 → 决策 → 任务）──
  {
    id: "overview",
    path: "",
    labelKey: "menu.overview",
    icon: "overview",
    group: "core",
    exact: true,
  },
  { id: "board", path: "/board", labelKey: "menu.board", icon: "board", group: "core" },
  { id: "my-tasks", path: "/my-tasks", labelKey: "menu.myTasks", icon: "myTasks", group: "core" },
  { id: "im", path: "/im", labelKey: "menu.messages", icon: "im", group: "core" },
  {
    id: "decisions",
    path: "/decisions",
    labelKey: "menu.decisions",
    icon: "decisions",
    group: "core",
  },

  // ── 协作 ──
  {
    id: "meetings",
    path: "/meetings",
    labelKey: "menu.meetings",
    icon: "meetings",
    group: "collaboration",
  },
  {
    id: "meeting-minutes",
    path: "/meeting-minutes",
    labelKey: "menu.meetingMinutes",
    icon: "meetingMinutes",
    group: "collaboration",
  },
  {
    id: "approvals",
    path: "/approvals",
    labelKey: "menu.approvals",
    icon: "approvals",
    group: "collaboration",
  },
  {
    id: "announcements",
    path: "/announcements",
    labelKey: "menu.announcements",
    icon: "announcements",
    group: "collaboration",
  },
  {
    id: "calendar",
    path: "/calendar",
    labelKey: "menu.calendar",
    icon: "calendar",
    group: "collaboration",
  },
  {
    id: "contacts",
    path: "/contacts",
    labelKey: "menu.contacts",
    icon: "contacts",
    group: "collaboration",
  },

  // ── 知识 ──
  {
    id: "documents",
    path: "/documents",
    labelKey: "menu.documents",
    icon: "documents",
    group: "knowledge",
  },
  { id: "files", path: "/files", labelKey: "menu.files", icon: "files", group: "knowledge" },
  { id: "wiki", path: "/wiki", labelKey: "menu.wiki", icon: "wiki", group: "knowledge" },
  {
    id: "whiteboards",
    path: "/whiteboards",
    labelKey: "menu.whiteboards",
    icon: "whiteboards",
    group: "knowledge",
  },
  {
    id: "databases",
    path: "/databases",
    labelKey: "menu.databases",
    icon: "databases",
    group: "knowledge",
  },
  { id: "forms", path: "/forms", labelKey: "menu.forms", icon: "forms", group: "knowledge" },
  {
    id: "recycle-bin",
    path: "/recycle-bin",
    labelKey: "menu.recycleBin",
    icon: "recycleBin",
    group: "knowledge",
  },

  // ── 规划 ──
  { id: "okr", path: "/okr", labelKey: "menu.okr", icon: "okr", group: "planning" },
  {
    id: "workflows",
    path: "/workflows",
    labelKey: "menu.workflows",
    icon: "workflows",
    group: "planning",
  },
  {
    id: "templates",
    path: "/templates",
    labelKey: "menu.templates",
    icon: "templates",
    group: "planning",
  },
  {
    id: "time-tracking",
    path: "/time-tracking",
    labelKey: "menu.timeTracking",
    icon: "timeTracking",
    group: "planning",
  },

  // ── AI 辅助（辅助角色，不是产品标签）──
  { id: "ai-tools", path: "/ai-tools", labelKey: "menu.aiTools", icon: "aiTools", group: "ai" },
  { id: "insight", path: "/insight", labelKey: "menu.insight", icon: "insight", group: "ai" },
  {
    id: "knowledge-qa",
    path: "/knowledge-qa",
    labelKey: "menu.knowledgeQa",
    icon: "knowledgeQa",
    group: "ai",
  },
  {
    id: "daily-report",
    path: "/daily-report",
    labelKey: "menu.dailyReport",
    icon: "dailyReport",
    group: "ai",
  },
  {
    id: "announcement-draft",
    path: "/announcement-draft",
    labelKey: "menu.announcementDraft",
    icon: "announcementDraft",
    group: "ai",
  },

  // ── 管理（viewer 隐藏前三个）──
  {
    id: "members",
    path: "/members",
    labelKey: "menu.members",
    icon: "members",
    group: "admin",
    viewerHidden: true,
  },
  {
    id: "billing",
    path: "/billing",
    labelKey: "menu.billing",
    icon: "billing",
    group: "admin",
    viewerHidden: true,
  },
  {
    id: "analytics",
    path: "/analytics",
    labelKey: "menu.analytics",
    icon: "analytics",
    group: "admin",
    viewerHidden: true,
  },
  {
    id: "settings",
    path: "/settings",
    labelKey: "menu.settings",
    icon: "settings",
    group: "admin",
  },
];

/** 生成模块的绝对路径（工作区前缀） */
export function moduleHref(module: WorkspaceModule, wid: string): string {
  return `/w/${wid}${module.path}`;
}

/** 某分组内的模块（保持注册表顺序） */
export function modulesInGroup(group: ModuleGroupId): WorkspaceModule[] {
  return WORKSPACE_MODULES.filter((m) => m.group === group);
}

/**
 * 默认占首屏的模块 id（产品方案 §5）：核心 6 + 管理 4。
 *
 * 为什么用**显式 id 清单**而不是给每个模块加 `defaultVisible` 字段、也不按 group 推导：
 *  - 按 group 推导会把握手可见性与分组绑死——挪一个模块的分组就悄悄改了首屏；
 *  - 逐对象加字段则 31 处散落，看不出"首屏到底哪 10 个"。
 * 一张清单 + 下面两条断言（并集恰好 31、核心/管理顺序），既能被单测钉住，也一眼可读。
 * **可选 ≠ 删除**：不在清单里的模块只是默认收进「更多」，路由与 API 全部保留。
 */
export const DEFAULT_VISIBLE_MODULE_IDS: readonly string[] = [
  // 核心 6（产品楔子：讨论 → 决策 → 任务）
  "overview",
  "board",
  "my-tasks",
  "decisions",
  "im",
  "documents",
  // 管理 4
  "members",
  "billing",
  "analytics",
  "settings",
];

/** 该角色可见的模块：viewer 隐藏 viewerHidden 的模块 */
export function modulesForRole(role: string): WorkspaceModule[] {
  return role === "viewer"
    ? WORKSPACE_MODULES.filter((m) => !m.viewerHidden)
    : [...WORKSPACE_MODULES];
}

/** 默认占首屏的模块（核心 6 + 管理 4，按角色过滤） */
export function primaryModulesForRole(role: string): WorkspaceModule[] {
  const visible = new Set(DEFAULT_VISIBLE_MODULE_IDS);
  return modulesForRole(role).filter((m) => visible.has(m.id));
}

/** 收进「更多」分组的模块（默认收起，仍可从侧栏展开或用 Cmd+K 直达） */
export function optionalModulesForRole(role: string): WorkspaceModule[] {
  const visible = new Set(DEFAULT_VISIBLE_MODULE_IDS);
  return modulesForRole(role).filter((m) => !visible.has(m.id));
}
