"use client";

/**
 * DecisionMarkView — 决策标记卡片 NodeView 渲染组件（Phase 1b）。
 *
 * 设计取舍：
 * - 用 @tiptap/react 的 NodeViewWrapper 包裹，让 ProseMirror 把这个 React
 *   组件作为节点的 DOM 出口；atom 节点不需要 NodeViewContent（无内部文本）。
 * - 卡片显示：决策标题 + 状态徽标 + 截止日期 + 版本号。
 * - 点击跳转到 /w/[wid]/decisions 页面（复用现有决策列表页，避免新建详情路由）；
 *   wid 由扩展 options 注入，通过 editor.extensionStorage 拿到。
 * - 状态徽标颜色走 --status-*-fg token（与 task-meta 一致），无裸 hex。
 * - 截止日期用 Intl.DateTimeFormat 格式化，locale 从 next-intl 获取（客户端）。
 * - lucide-react 图标 size=16（design 规范）。
 * - 尊重 prefers-reduced-motion：动画时长由 --motion-* token 控制。
 * - 可访问性：role="link" + aria-label 描述跳转目标；键盘 Enter/Space 触发跳转。
 */

import { type KeyboardEvent, type MouseEvent } from "react";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n-navigation";
import { Gavel, Calendar, GitBranch } from "lucide-react";
import type { DecisionStatus } from "./decisionMarkExtension";

/** 从 NodeView props 中提取 attrs（与 decisionMarkExtension.addAttributes 对齐） */
interface DecisionMarkNodeAttrs {
  decisionId: string;
  title: string;
  status: DecisionStatus;
  dueDate: string | null;
  version: number | null;
}

/** 状态徽标样式映射（复用 --status-*-fg token，与 task-meta 一致） */
function statusBadgeClass(status: DecisionStatus): string {
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
function statusKey(status: DecisionStatus): string {
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
 * DecisionMarkView — 决策卡片 NodeView。
 *
 * props 由 ReactNodeViewRenderer 注入：node / editor / selected / updateAttributes 等。
 * 这里只读 node.attrs，不修改（atom 节点 attrs 由父组件插入时定型）。
 */
export function DecisionMarkView({ node, editor }: ReactNodeViewProps) {
  const t = useTranslations("editor.decisionMark");
  const tStatus = useTranslations("taskShare.status");
  const router = useRouter();

  const attrs = node.attrs as DecisionMarkNodeAttrs;
  const { decisionId, title, status, dueDate, version } = attrs;

  // 从扩展 options 拿 wid（DecisionMark.configure({ wid }) 注入）
  const wid =
    (editor.extensionStorage as { decisionMark?: { wid?: string } }).decisionMark?.wid ?? "";

  const locale = detectLocale();
  const dueText = formatDueDate(dueDate, locale);

  /** 跳转到决策列表页（复用现有 /w/[wid]/decisions 路由） */
  const go = () => {
    if (!wid) return;
    router.push(`/w/${wid}/decisions`);
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
      className="decision-mark-wrapper my-[var(--space-2)]"
      // 不让点击进入编辑器选中态——直接跳转
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
        className="decision-mark-card flex items-start gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] shadow-[var(--elev-sm)] cursor-pointer transition-shadow duration-[var(--motion-fast)] hover:shadow-[var(--elev-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        data-decision-id={decisionId}
        data-status={status}
      >
        {/* 左侧图标：决策锤（Gavel） */}
        <Gavel
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
            {/* 截止日期 */}
            {dueText ? (
              <span className="inline-flex items-center gap-1">
                <Calendar size={16} className="text-[var(--muted)]" aria-hidden="true" />
                <span>{dueText}</span>
              </span>
            ) : null}
            {/* 版本号 */}
            {version != null ? (
              <span className="inline-flex items-center gap-1">
                <GitBranch size={16} className="text-[var(--muted)]" aria-hidden="true" />
                <span>v{version}</span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export default DecisionMarkView;