// 任务详情页共享类型与常量。
// 拆分自 app/[locale]/w/[wid]/task/[id]/page.tsx，保持类型定义单一来源。

export type Status = "todo" | "in_progress" | "review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface Person {
  id: string;
  name: string | null;
  email: string;
  image?: string | null;
}

export interface SubtaskItem {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  blocked: boolean;
  blockedReason: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  dueDate: string | null;
  assignee: Person | null;
  creator: Person | null;
  createdAt: string;
  updatedAt: string;
  blocked: boolean;
  blockedReason: string | null;
  /** 公开分享 token（null=未分享；本地推导只读外链） */
  shareToken: string | null;
  children: SubtaskItem[];
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: Person;
}

export interface Decision {
  id: string;
  markdown: string;
  version: number;
  createdAt: string;
  author: Person;
}

export interface DecisionVersion {
  id: string;
  decisionId: string;
  markdown: string;
  version: number;
  createdAt: string;
  author: Person;
}

export const PRIORITY_META: Record<Priority, { labelKey: string; color: string }> = {
  low: { labelKey: "low", color: "var(--meta)" },
  medium: { labelKey: "medium", color: "var(--muted)" },
  high: { labelKey: "high", color: "var(--warn)" },
  urgent: { labelKey: "urgent", color: "var(--danger)" },
};