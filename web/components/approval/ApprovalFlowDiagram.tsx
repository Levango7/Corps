"use client";

/**
 * 审批流程图可视化组件。
 *
 * 水平渲染审批节点链：节点1 → 节点2 → 节点3 …
 * - 已通过节点：绿色边框 + 勾选图标（var(--success)）
 * - 当前节点：高亮边框（var(--accent)）+ 脉冲圆点
 * - 已拒绝节点：红色边框（var(--danger)）
 * - 未到达节点：默认边框（var(--border)）
 *
 * 节点间用 lucide-react ArrowRight 连接。
 * 响应式：小屏自动横向滚动（overflow-x-auto）。
 */

import { ArrowRight, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ApprovalFlowNode {
  name: string;
  order: number;
  approverRole?: string;
  approverUserId?: string;
  /** 审批人显示名（前端拼装或后端返回） */
  approverDisplayName?: string;
}

interface ApprovalFlowDiagramProps {
  /** 审批节点列表（按 order 升序） */
  nodes: ApprovalFlowNode[];
  /** 当前节点序号（1-based；0 表示尚未开始；-1 表示全部完成） */
  currentNode: number;
  /** 审批实例状态：pending | approved | rejected | withdrawn */
  status: string;
}

export function ApprovalFlowDiagram({
  nodes,
  currentNode,
  status,
}: ApprovalFlowDiagramProps) {
  const t = useTranslations("approval");

  if (!nodes || nodes.length === 0) {
    return (
      <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
        {t("noContent")}
      </p>
    );
  }

  // 按 order 升序排序
  const sortedNodes = [...nodes].sort((a, b) => a.order - b.order);

  return (
    <div className="overflow-x-auto -mx-[var(--space-2)] px-[var(--space-2)]">
      <ol className="flex items-center gap-[var(--space-2)] min-w-max">
        {sortedNodes.map((node, idx) => {
          // 节点状态判定
          const isPassed =
            status === "approved"
              ? true
              : status === "rejected"
                ? node.order < currentNode
                : node.order < currentNode;
          const isCurrent =
            status === "pending" && node.order === currentNode;
          const isRejected =
            status === "rejected" && node.order === currentNode;

          // 边框 / 文本 / 背景色
          let borderColor = "var(--border)";
          let textColor = "var(--fg-2)";
          let bgColor = "var(--surface)";
          let iconEl: React.ReactNode = null;

          if (isPassed) {
            borderColor = "var(--success)";
            textColor = "var(--success)";
            bgColor = "var(--surface)";
            iconEl = <CheckCircle2 size={14} className="shrink-0" />;
          } else if (isRejected) {
            borderColor = "var(--danger)";
            textColor = "var(--danger)";
            bgColor = "var(--surface)";
            iconEl = <XCircle size={14} className="shrink-0" />;
          } else if (isCurrent) {
            borderColor = "var(--accent)";
            textColor = "var(--accent)";
            bgColor = "var(--surface)";
            iconEl = (
              <Clock size={14} className="shrink-0 animate-pulse" />
            );
          }

          const approverLabel = node.approverDisplayName
            ? t("nodeApprover", { name: node.approverDisplayName })
            : node.approverRole
              ? t("nodeApproverRole", { role: node.approverRole })
              : null;

          return (
            <li
              key={`${node.order}-${idx}`}
              className="flex items-center gap-[var(--space-2)]"
            >
              <div
                className="flex flex-col items-start gap-1 min-w-[140px] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] border bg-[var(--surface)] transition-colors duration-[var(--motion-fast)]"
                style={{
                  borderColor,
                  background: bgColor,
                }}
                aria-current={isCurrent ? "step" : undefined}
              >
                <div className="flex items-center gap-1.5">
                  {iconEl}
                  <span
                    className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] truncate"
                    style={{ color: textColor }}
                    title={node.name}
                  >
                    {node.name}
                  </span>
                </div>
                {approverLabel && (
                  <span className="text-[length:var(--text-xs)] text-[var(--meta)] truncate max-w-[180px]">
                    {approverLabel}
                  </span>
                )}
                <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                  {isPassed
                    ? t("passed")
                    : isCurrent
                      ? t("waiting")
                      : isRejected
                        ? t("rejected")
                        : t("notReached")}
                </span>
              </div>
              {idx < sortedNodes.length - 1 && (
                <ArrowRight
                  size={16}
                  className="shrink-0 text-[var(--muted)]"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default ApprovalFlowDiagram;