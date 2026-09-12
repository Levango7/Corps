"use client";

/**
 * TaskEmbedView — 任务嵌入卡片 NodeView 渲染组件（Phase 1b）。
 *
 * 设计取舍：
 * - 用 @tiptap/react 的 NodeViewWrapper 包裹；atom 节点不需要 NodeViewContent。
 * - 卡片显示：任务标题 + 状态徽标 + 负责人 + 截止日期。
 * - 点击跳转到 /w/[wid]/task/[id] 任务详情页；
 *   wid 由扩展 options 注入，通过 editor.extensionStorage 拿到。
 * - 状态徽标颜色走 --status-*-fg token（与 task-meta 一致），无裸 hex。
 * - 截止日期用 Intl.DateTimeFormat 格式化，locale 从 navigator.language 推断。
 * - lucide-react 图标 size=16（design 规范）。
 * - 尊重 prefers-reduced-motion：动画时长由 --motion-* token 控制。
 * - 可访问性：role="link" + aria-label 描述跳转目标；键盘 Enter/Space 触发跳转。
 */

import { type KeyboardEvent, type MouseEvent } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { ListTodo, User, Calendar } from "lucide-react";
import type { TaskStatus } from "./taskEmbedExtension";

/** 从 NodeView props 中提取 attrs（与 taskEmbedExtension.addAttributes 对齐） */
interface TaskEmbedNodeAttrs {
  taskId: string;
  title: string;
  status: TaskStatus;
  assigneeName: string | null;
  dueDate: string | null;
}

/** 状态徽标样式映射（复用 --status-*-fg token，与 task-meta 一致） */
function statusBadgeClass(status: TaskStatus): string {
  switch (status) {
    case "done":
      return "bg-[var(--success-soft)] text-[var(--status-done-fg)]";
    case "in_progress":
      return "bg-[var(--accent-soft)] text-[var(--status-doing-fg)]";
    case "review":
      return "bg-[var(--warn-soft)] text-[var(--status-warn-fg)]";
    case "todo":
    default:
      return "bg-[var(--surface-2)] text-[var(--status-todo-fg)]";
  }
}

/** 状态 i18n key 后缀（与 taskShare.status 对齐复用） */
function statusKey(status: TaskStatus): string {
  switch (status) {
    case "done":
      return "done";
    case "in_progress":
      return "in_progress";
    case "review":
      return "review";
    case "todo":
    default:
      return "todo";
  }
}

/** 截止日期格式化（客户端 Intl，避免 SSR locale 不一致） */
function formatDueDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return null;
  }
}

/** 从 navigator.language 推断 Intl locale（SSR 安全） */
function detectLocale(): string {
  if (typeof navigator === "undefined") return "en";
  return navigator.language || "en";
}

/**
 * TaskEmbedView — 任务卡片 NodeView。
 *
 * props 由 ReactNodeViewRenderer 注入：node / editor / selected / updateAttributes 等。
 * 这里只读 node.attrs，不修改（atom 节点 attrs 由父组件插入时定型）。
 */
export function TaskEmbedView({ node, editor }: ReactNodeViewProps) {
  const t = useTranslations("editor.taskEmbed");
  const tStatus = useTranslations("taskShare.status");
  const router = useRouter();

  const attrs = node.attrs as TaskEmbedNodeAttrs;
  const { taskId, title, status, assigneeName, dueDate } = attrs;

  // 从扩展 options 拿 wid（TaskEmbed.configure({ wid }) 注入）
  const wid =
    (editor.extensionStorage as { taskEmbed?: { wid?: string } }).taskEmbed?.wid ?? "";

  const locale = detectLocale();
  const dueText = formatDueDate(dueDate, locale);

  /** 跳转到任务详情页 /w/[wid]/task/[id] */
  const go = () => {
    if (!wid || !taskId) return;
    router.push(`/w/${wid}/task/${taskId}`);
  };

  /** 键盘激活（a11y：role=link 期望 Enter/Space 触发） */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  };

  return (
    <NodeViewWrapper
      as="div"
      className="task-embed-wrapper my-[var(--space-2)]"
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        go();
      }}
      onKeyDown={onKeyDown}
      role="link"
      tabIndex={0}
      aria-label={`${t("cardLabel")}: ${title || t("untitled")}`}
    >
      <div
        className="task-embed-card flex items-start gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] shadow-[var(--elev-sm)] cursor-pointer transition-shadow duration-[var(--motion-fast)] hover:shadow-[var(--elev-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        data-task-id={taskId}
        data-status={status}
      >
        {/* 左侧图标：任务清单（ListTodo） */}
        <ListTodo
          size={16}
          className="mt-0.5 shrink-0 text-[var(--accent)]"
          aria-hidden="true"
        />

        {/* 中间：标题 + 元信息 */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="text-[length:var(--text-sm)] font-[family-name:var(--font-body)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
            {title || t("untitled")}
          </div>
          <div className="flex items-center gap-[var(--space-2)] flex-wrap text-[length:var(--text-xs)] text-[var(--meta)]">
            {/* 状态徽标 */}
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] font-[weight:var(--weight-medium)] ${statusBadgeClass(
                status,
              )}`}
            >
              {tStatus(statusKey(status) as "todo" | "in_progress" | "review" | "done")}
            </span>
            {/* 负责人 */}
            {assigneeName ? (
              <span className="inline-flex items-center gap-1">
                <User size={16} className="text-[var(--muted)]" aria-hidden="true" />
                <span className="truncate max-w-[12ch]">{assigneeName}</span>
              </span>
            ) : null}
            {/* 截止日期 */}
            {dueText ? (
              <span className="inline-flex items-center gap-1">
                <Calendar size={16} className="text-[var(--muted)]" aria-hidden="true" />
                <span>{dueText}</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export default TaskEmbedView;