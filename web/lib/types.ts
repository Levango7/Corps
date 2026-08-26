/**
 * 共享领域类型 —— 单一编辑源。
 *
 * 各页面/组件请从此处 import，禁止本地重复定义 Task/Status/Priority 等，
 * 避免字段漂移与类型不安全（task 详情页与看板页曾因 Task.assignee 形态不一致触发运行时错误）。
 *
 * 后端响应形态以 Prisma include 为准：assignee 为对象或 null，非 undefined。
 */

/** 任务状态机：与 tasks 表 CHECK 约束严格一致。 */
export type Status = "todo" | "in_progress" | "review" | "done";

/** 任务优先级：与 tasks 表 CHECK 约束严格一致。 */
export type Priority = "low" | "medium" | "high" | "urgent";

/** 角色：与 members 表 CHECK 约束严格一致。 */
export type Role = "owner" | "admin" | "member";

/** 人员摘要：assignee/creator/author 共用。image 仅 creator/assignee 在详情页 include。 */
export interface Person {
  id: string;
  name: string | null;
  email: string;
  image?: string | null;
}

/**
 * 任务实体（列表/看板形态）。
 * description 在列表场景不返回；详情页通过 GET /tasks/:id 拿到完整字段。
 */
export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: Status;
  priority: Priority;
  assigneeId?: string | null;
  assignee?: Person | null;
  creator?: Person | null;
  dueDate?: string | null;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 任务详情形态：description 必有，assignee/creator 完整。 */
export interface TaskDetail extends Task {
  description: string | null;
  assignee: Person | null;
  creator: Person | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 评论 */
export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: Person;
}

/** 决策记录（列表形态） */
export interface Decision {
  id: string;
  taskId: string;
  taskTitle?: string;
  markdown: string;
  version: number;
  authorId?: string;
  authorName?: string;
  author?: Person;
  createdAt: string;
  updatedAt: string;
}

/** 决策版本历史 */
export interface DecisionVersion {
  id: string;
  decisionId: string;
  markdown: string;
  version: number;
  createdAt: string;
  author: Person;
}

/** 通知类型 */
export type NotificationType =
  "mention" | "task_assigned" | "task_updated" | "comment_added" | "decision_updated";

/** 通知 */
export interface Notification {
  id: string;
  type: NotificationType;
  entityId: string;
  entityTitle: string;
  read: boolean;
  createdAt: string;
}

/** 工作区摘要（layout 切换器形态） */
export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

/** 工作区详情（设置页形态） */
export interface WorkspaceDetail extends WorkspaceSummary {
  plan: string;
  seatLimit: number;
  memberCount: number;
  taskCount: number;
  createdAt: string;
}

/** 成员 */
export interface Member {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  isSelf: boolean;
  joinedAt: string;
}

/**
 * 后端统一响应信封：{ code, message, data }。
 * 与 lib/api.ts 中 ApiResponse 保持一致，集中定义避免漂移。
 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}
