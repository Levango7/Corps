"use client";

/**
 * taskEmbedExtension — 任务嵌入 TipTap Node 扩展（Phase 1b）。
 *
 * 设计取舍：
 * - 用块级 Node 实现：任务卡片是块级元素，占整行展示标题/状态/负责人/截止。
 * - schema attrs：taskId / title / status / assigneeName / dueDate
 *   （冗余存储避免每次渲染查 DB；由父组件插入时填入）
 * - atom: true —— 卡片不可编辑内部文本，整体选中/删除。
 * - group: "block" —— 可出现在文档顶层。
 * - selectable + draggable：用户可选中复制、拖拽重排。
 * - 通过 Slash Menu `/task` 触发插入：Slash Menu 走 onInsertTask 回调
 *   由父组件打开任务选择器，选中后用 editor.commands.insertTaskEmbed(attrs) 插入。
 * - NodeView 通过 ReactNodeViewRenderer 挂载 TaskEmbedView 组件，
 *   组件内点击跳转到 /w/[wid]/task/[id] 任务详情页。
 * - 所有样式走 design token，无裸 hex。
 * - 尊重 prefers-reduced-motion：动画时长由 CSS token 控制。
 */

import { Node, mergeAttributes, type CommandProps } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TaskEmbedView } from "./TaskEmbedView";

/** 任务状态枚举（与 Task.status 对齐） */
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

/** 任务嵌入 attrs（与 schema addAttributes 对齐） */
export interface TaskEmbedAttrs {
  /** 任务 ID（Prisma Task.id，UUID） */
  taskId: string;
  /** 任务标题（冗余存储） */
  title: string;
  /** 任务状态（冗余存储，复用 --status-* token 渲染徽标） */
  status: TaskStatus;
  /** 负责人姓名（冗余存储，避免渲染时查 User 表） */
  assigneeName: string | null;
  /** 截止日期 ISO 字符串（可选） */
  dueDate: string | null;
}

/** 扩展配置：父组件注入 workspace id 用于构造跳转链接 */
export interface TaskEmbedOptions {
  /** 当前 workspace id（用于点击跳转 /w/[wid]/task/[id]） */
  wid: string;
}

// 声明 insertTaskEmbed 命令加入 TipTap Commands 接口
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    taskEmbed: {
      /** 插入任务嵌入节点：editor.commands.insertTaskEmbed(attrs) */
      insertTaskEmbed: (attrs: TaskEmbedAttrs) => ReturnType;
    };
  }
}

/**
 * TaskEmbed 扩展：块级任务卡片节点。
 *
 * 用法：
 * ```ts
 * TaskEmbed.configure({ wid })
 * ```
 *
 * 插入任务卡片（由父组件或 Slash Menu 触发）：
 * ```ts
 * editor.chain().focus().insertContent({
 *   type: "taskEmbed",
 *   attrs: { taskId, title, status, assigneeName, dueDate },
 * }).run()
 * ```
 */
export const TaskEmbed = Node.create<TaskEmbedOptions>({
  name: "taskEmbed",

  group: "block",

  atom: true,

  selectable: true,
  draggable: true,

  inline: false,

  addOptions() {
    return {
      wid: "",
    };
  },

  addAttributes() {
    return {
      taskId: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-task-id") ?? "",
        renderHTML: (attrs) => {
          const id = (attrs as { taskId?: string }).taskId;
          return id ? { "data-task-id": id } : {};
        },
      },
      title: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-title") ?? "",
        renderHTML: (attrs) => {
          const title = (attrs as { title?: string }).title;
          return title ? { "data-title": title } : {};
        },
      },
      status: {
        default: "todo" as TaskStatus,
        parseHTML: (el) =>
          ((el as HTMLElement).getAttribute("data-status") as TaskStatus) ?? "todo",
        renderHTML: (attrs) => {
          const status = (attrs as { status?: TaskStatus }).status;
          return status ? { "data-status": status } : {};
        },
      },
      assigneeName: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-assignee"),
        renderHTML: (attrs) => {
          const assigneeName = (attrs as { assigneeName?: string | null }).assigneeName;
          return assigneeName ? { "data-assignee": assigneeName } : {};
        },
      },
      dueDate: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-due-date"),
        renderHTML: (attrs) => {
          const dueDate = (attrs as { dueDate?: string | null }).dueDate;
          return dueDate ? { "data-due-date": dueDate } : {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-type='task-embed']",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "task-embed" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskEmbedView, {
      as: "div",
      className: "task-embed-nodeview",
    });
  },

  // 暴露插入命令：editor.commands.insertTaskEmbed(attrs)
  addCommands() {
    return {
      insertTaskEmbed:
        (attrs: TaskEmbedAttrs) =>
        ({ commands }: CommandProps) => {
          return commands.insertContent({
            type: "taskEmbed",
            attrs,
          });
        },
    };
  },
});

export default TaskEmbed;