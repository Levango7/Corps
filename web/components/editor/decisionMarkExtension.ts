"use client";

/**
 * decisionMarkExtension — 决策标记 TipTap Node 扩展（Phase 1b）。
 *
 * 设计取舍：
 * - 用块级 Node（非 Mark）实现：决策卡片是块级元素，占整行展示标题/状态/截止，
 *   Mark 是行内标记不适用。NodeView 用 React 渲染可点击卡片。
 * - schema attrs：decisionId / title / status / dueDate / version
 *   （version 用于决策版本留痕，可选；其余为渲染必需）
 * - atom: true —— 卡片不可编辑内部文本，整体选中/删除，避免 ProseMirror
 *   尝试把光标放进卡片内部导致 NodeView contentDOM 错乱。
 * - group: "block" —— 可出现在文档顶层，不可嵌套进 list/blockquote
 *   （ProseMirror schema 自动约束）。
 * - selectable + draggable：用户可选中复制、拖拽重排。
 * - 通过 Slash Menu `/decision` 或 `> [decision]` 触发插入：
 *   Slash Menu 走 onInsertDecision 回调由父组件打开选择器；
 *   `> [decision]` 由 InputRule 捕获，但需要决策 id 才能渲染——
 *   实际场景里 `> [decision]` 只能插入「占位决策卡片」，父组件监听
 *   editor.storage.decisionMarkPending 事件后打开选择器补全 attrs。
 *   本扩展只负责 schema + NodeView，插入触发由 slashMenuExtension / 父组件承担。
 * - NodeView 通过 ReactNodeViewRenderer 挂载 DecisionMarkView 组件，
 *   组件内点击跳转到 /w/[wid]/decisions 页面（wid 由父组件通过 options 注入）。
 * - 所有样式走 design token，无裸 hex。
 * - 尊重 prefers-reduced-motion：动画时长由 CSS token 控制。
 */

import { Node, mergeAttributes, type CommandProps } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DecisionMarkView } from "./DecisionMarkView";

/** 决策状态枚举（与 Task.status 对齐，复用状态色 token） */
export type DecisionStatus = "todo" | "in_progress" | "review" | "done";

/** 决策标记 attrs（与 schema addAttributes 对齐） */
export interface DecisionMarkAttrs {
  /** 决策记录 ID（Prisma Decision.id，UUID） */
  decisionId: string;
  /** 决策标题（冗余存储，避免每次渲染都查 DB；由父组件插入时填入） */
  title: string;
  /** 决策状态（冗余存储，复用 --status-* token 渲染徽标） */
  status: DecisionStatus;
  /** 截止日期 ISO 字符串（可选，由父组件插入时填入） */
  dueDate: string | null;
  /** 决策版本号（可选，Decision.version） */
  version: number | null;
}

/** 扩展配置：父组件注入 workspace id 用于构造跳转链接 */
export interface DecisionMarkOptions {
  /** 当前 workspace id（用于点击跳转 /w/[wid]/decisions） */
  wid: string;
}

// 声明 insertDecisionMark 命令加入 TipTap Commands 接口
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    decisionMark: {
      /** 插入决策标记节点：editor.commands.insertDecisionMark(attrs) */
      insertDecisionMark: (attrs: DecisionMarkAttrs) => ReturnType;
    };
  }
}

/**
 * DecisionMark 扩展：块级决策卡片节点。
 *
 * 用法：
 * ```ts
 * DecisionMark.configure({ wid })
 * ```
 *
 * 插入决策卡片（由父组件或 Slash Menu 触发）：
 * ```ts
 * editor.chain().focus().insertContent({
 *   type: "decisionMark",
 *   attrs: { decisionId, title, status, dueDate, version },
 * }).run()
 * ```
 */
export const DecisionMark = Node.create<DecisionMarkOptions>({
  name: "decisionMark",

  group: "block",

  // atom: 卡片不可编辑内部文本，整体选中/删除
  atom: true,

  // 允许选中 + 拖拽
  selectable: true,
  draggable: true,

  // 允许光标在卡片前后停留（inline 不需要）
  inline: false,

  addOptions() {
    return {
      wid: "",
    };
  },

  addAttributes() {
    return {
      decisionId: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-decision-id") ?? "",
        renderHTML: (attrs) => {
          const id = (attrs as { decisionId?: string }).decisionId;
          return id ? { "data-decision-id": id } : {};
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
        default: "todo" as DecisionStatus,
        parseHTML: (el) =>
          ((el as HTMLElement).getAttribute("data-status") as DecisionStatus) ?? "todo",
        renderHTML: (attrs) => {
          const status = (attrs as { status?: DecisionStatus }).status;
          return status ? { "data-status": status } : {};
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
      version: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute("data-version");
          return v ? Number(v) : null;
        },
        renderHTML: (attrs) => {
          const version = (attrs as { version?: number | null }).version;
          return version != null ? { "data-version": String(version) } : {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-type='decision-mark']",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "decision-mark" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DecisionMarkView, {
      // 用 div 包裹，与 parseHTML tag 对齐
      as: "div",
      className: "decision-mark-nodeview",
    });
  },

  // 暴露插入命令：editor.commands.insertDecisionMark(attrs)
  addCommands() {
    return {
      insertDecisionMark:
        (attrs: DecisionMarkAttrs) =>
        ({ commands }: CommandProps) => {
          return commands.insertContent({
            type: "decisionMark",
            attrs,
          });
        },
    };
  },
});

export default DecisionMark;