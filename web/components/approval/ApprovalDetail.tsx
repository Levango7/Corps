"use client";

/**
 * 审批详情组件。
 *
 * 功能：
 * - 拉取审批详情（GET /api/v1/workspaces/{wid}/approvals/instances/{aid}）
 * - 展示：标题、描述、申请人、状态、提交时间
 * - 审批内容（JSON 渲染为键值对表格）
 * - 审批流程图（ApprovalFlowDiagram）
 * - 操作记录时间线（操作人、动作、时间、备注）
 * - 操作按钮：同意 / 拒绝（当前用户是当前节点审批人时）/ 撤回（当前用户是申请人且 pending）
 * - 操作弹窗（输入备注）
 *
 * 当前用户身份通过 GET /api/v1/users/me 获取 { id }。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n-navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  FileText,
  MinusCircle,
  X,
  CornerDownRight,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  ApprovalFlowDiagram,
  type ApprovalFlowNode,
} from "./ApprovalFlowDiagram";

/** 审批实例详情（与后端 GET /instances/{aid} 响应一致） */
interface ApprovalInstanceDetail {
  id: string;
  title: string;
  description?: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  applicantId: string;
  applicantName?: string | null;
  applicantEmail?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  /** 审批内容（键值对对象） */
  content?: Record<string, unknown> | null;
  /** 审批节点定义 */
  nodes?: ApprovalFlowNode[] | null;
  /** 当前节点序号（1-based；-1 表示全部完成） */
  currentNode?: number;
  submittedAt: string;
  completedAt?: string | null;
  /** 当前节点审批人 ID 列表（用于判断当前用户能否审批） */
  currentApproverIds?: string[] | null;
  /** 操作记录时间线 */
  operations?: ApprovalOperation[] | null;
}

interface ApprovalOperation {
  id: string;
  /** 操作动作：submit | approve | reject | withdraw */
  action: "submit" | "approve" | "reject" | "withdraw";
  operatorId: string;
  operatorName?: string | null;
  operatorEmail?: string | null;
  nodeOrder?: number | null;
  nodeName?: string | null;
  comment?: string | null;
  createdAt: string;
}

interface ApprovalDetailProps {
  approvalId: string;
  workspaceId: string;
}

/** 状态 → 图标 + 颜色 token */
function getStatusVisual(status: ApprovalInstanceDetail["status"]) {
  switch (status) {
    case "approved":
      return {
        icon: <CheckCircle2 size={14} className="shrink-0" />,
        color: "var(--success)",
        bg: "var(--success-soft, var(--surface-2))",
        labelKey: "approved",
      };
    case "rejected":
      return {
        icon: <XCircle size={14} className="shrink-0" />,
        color: "var(--danger)",
        bg: "var(--danger-soft, var(--surface-2))",
        labelKey: "rejected",
      };
    case "withdrawn":
      return {
        icon: <MinusCircle size={14} className="shrink-0" />,
        color: "var(--muted)",
        bg: "var(--surface-2)",
        labelKey: "withdrawn",
      };
    case "pending":
    default:
      return {
        icon: <Clock size={14} className="shrink-0" />,
        color: "var(--warning, var(--accent))",
        bg: "var(--warning-soft, var(--surface-2))",
        labelKey: "pending",
      };
  }
}

/** 操作动作 → i18n key */
function getActionLabelKey(action: ApprovalOperation["action"]) {
  switch (action) {
    case "approve":
      return "operationApprove";
    case "reject":
      return "operationReject";
    case "withdraw":
      return "operationWithdraw";
    case "submit":
    default:
      return "operationSubmit";
  }
}

/** 操作动作 → 颜色 token */
function getActionColor(action: ApprovalOperation["action"]) {
  switch (action) {
    case "approve":
      return "var(--success)";
    case "reject":
      return "var(--danger)";
    case "withdraw":
      return "var(--muted)";
    case "submit":
    default:
      return "var(--accent)";
  }
}

export function ApprovalDetail({
  approvalId,
  workspaceId,
}: ApprovalDetailProps) {
  const t = useTranslations("approval");
  const tButton = useTranslations("button");
  const [detail, setDetail] = useState<ApprovalInstanceDetail | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 操作弹窗状态
  const [actionDialog, setActionDialog] = useState<
    | { type: "approve" | "reject" | "withdraw"; confirmKey: string }
    | null
  >(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [d, me] = await Promise.all([
          api<ApprovalInstanceDetail>(
            `/api/v1/workspaces/${workspaceId}/approvals/instances/${approvalId}`,
          ),
          api<{ id: string }>("/api/v1/users/me").catch(() => ({
            id: "",
          })),
        ]);
        if (cancelled) return;
        setDetail(d);
        setCurrentUserId(me.id || null);
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof ApiError || e instanceof Error
            ? e.message
            : t("loadFailed"),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [approvalId, workspaceId, t]);

  // ESC 关闭弹窗
  useEffect(() => {
    if (!actionDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActionDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actionDialog]);

  async function handleAction(e: FormEvent) {
    e.preventDefault();
    if (!actionDialog || submitting) return;
    setSubmitting(true);
    setActionError("");
    try {
      const body = comment.trim()
        ? JSON.stringify({ comment: comment.trim() })
        : undefined;
      await api(
        `/api/v1/workspaces/${workspaceId}/approvals/instances/${approvalId}/${actionDialog.type}`,
        { method: "POST", body },
      );
      // 重新拉取详情
      const d = await api<ApprovalInstanceDetail>(
        `/api/v1/workspaces/${workspaceId}/approvals/instances/${approvalId}`,
      );
      setDetail(d);
      setActionDialog(null);
      setComment("");
    } catch (e) {
      setActionError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : t("operationFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-12)] text-center text-[var(--muted)]">
        <Loader2 size={20} className="inline animate-spin mr-2" />
        {t("loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
        <p className="text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
        <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
          {t("noApprovals")}
        </p>
      </div>
    );
  }

  const visual = getStatusVisual(detail.status);
  const applicant =
    detail.applicantName || detail.applicantEmail || "—";

  // 权限判定
  const isApplicant =
    currentUserId !== null && currentUserId === detail.applicantId;
  const isCurrentApprover =
    currentUserId !== null &&
    detail.status === "pending" &&
    Array.isArray(detail.currentApproverIds) &&
    detail.currentApproverIds!.includes(currentUserId);
  const canWithdraw = isApplicant && detail.status === "pending";
  const canApproveOrReject = isCurrentApprover;

  // 审批内容键值对
  const contentEntries = detail.content
    ? Object.entries(detail.content)
    : [];

  // 操作记录（按时间倒序展示，最新的在上）
  const operations = (detail.operations ?? []).slice().reverse();

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 返回链接 */}
      <Link
        href={`/w/${workspaceId}/approvals`}
        className="inline-flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--fg-2)] hover:text-[var(--fg)] mb-[var(--space-4)] transition-colors duration-[var(--motion-fast)]"
      >
        <ArrowLeft size={14} />
        {t("back")}
      </Link>

      {/* 标题 + 状态 */}
      <div className="flex items-start gap-3 mb-[var(--space-4)]">
        <FileText size={20} className="shrink-0 mt-1 text-[var(--muted)]" />
        <h1 className="flex-1 text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)] break-words">
          {detail.title}
        </h1>
        <span
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]"
          style={{ color: visual.color, background: visual.bg }}
        >
          {visual.icon}
          {t(visual.labelKey)}
        </span>
      </div>

      {/* 元信息 */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-[var(--space-5)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        <div>
          <dt className="text-[length:var(--text-xs)] text-[var(--meta)] mb-0.5">
            {t("applicant")}
          </dt>
          <dd className="text-[length:var(--text-sm)] text-[var(--fg)]">
            {applicant}
          </dd>
        </div>
        <div>
          <dt className="text-[length:var(--text-xs)] text-[var(--meta)] mb-0.5">
            {t("submittedAt")}
          </dt>
          <dd className="text-[length:var(--text-sm)] text-[var(--fg)]">
            {new Date(detail.submittedAt).toLocaleString()}
          </dd>
        </div>
        {detail.completedAt && (
          <div>
            <dt className="text-[length:var(--text-xs)] text-[var(--meta)] mb-0.5">
              {t("completedAt")}
            </dt>
            <dd className="text-[length:var(--text-sm)] text-[var(--fg)]">
              {new Date(detail.completedAt).toLocaleString()}
            </dd>
          </div>
        )}
        {detail.templateName && (
          <div>
            <dt className="text-[length:var(--text-xs)] text-[var(--meta)] mb-0.5">
              {t("selectTemplate")}
            </dt>
            <dd className="text-[length:var(--text-sm)] text-[var(--fg)]">
              {detail.templateName}
            </dd>
          </div>
        )}
      </dl>

      {/* 描述 */}
      {detail.description && (
        <section className="mb-[var(--space-5)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-2">
            {t("description")}
          </h2>
          <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] whitespace-pre-wrap break-words px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            {detail.description}
          </p>
        </section>
      )}

      {/* 审批内容 */}
      {contentEntries.length > 0 && (
        <section className="mb-[var(--space-5)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-2">
            {t("content")}
          </h2>
          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-[length:var(--text-sm)]">
              <thead>
                <tr className="border-b border-[var(--border-soft)] bg-[var(--surface-2)]">
                  <th className="text-left px-[var(--space-3)] py-2 font-[weight:var(--weight-medium)] text-[var(--meta)] w-1/3">
                    {t("contentKey")}
                  </th>
                  <th className="text-left px-[var(--space-3)] py-2 font-[weight:var(--weight-medium)] text-[var(--meta)]">
                    {t("contentValue")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-soft)]">
                {contentEntries.map(([key, value]) => (
                  <tr key={key}>
                    <td className="px-[var(--space-3)] py-2 text-[var(--fg-2)] font-[weight:var(--weight-medium)] break-words">
                      {key}
                    </td>
                    <td className="px-[var(--space-3)] py-2 text-[var(--fg)] break-words">
                      {typeof value === "object" && value !== null
                        ? JSON.stringify(value)
                        : String(value ?? "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 审批流程图 */}
      {detail.nodes && detail.nodes.length > 0 && (
        <section className="mb-[var(--space-5)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-2">
            {t("flowDiagram")}
          </h2>
          <div className="px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            <ApprovalFlowDiagram
              nodes={detail.nodes}
              currentNode={detail.currentNode ?? 0}
              status={detail.status}
            />
          </div>
        </section>
      )}

      {/* 操作记录时间线 */}
      <section className="mb-[var(--space-5)]">
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-2">
          {t("operations")}
        </h2>
        {operations.length === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--muted)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            {t("noOperations")}
          </p>
        ) : (
          <ol className="relative pl-6 space-y-3">
            {/* 时间线竖线 */}
            <span
              className="absolute left-2 top-2 bottom-2 w-px bg-[var(--border)]"
              aria-hidden="true"
            />
            {operations.map((op) => {
              const opColor = getActionColor(op.action);
              const operator =
                op.operatorName || op.operatorEmail || "—";
              return (
                <li key={op.id} className="relative">
                  {/* 时间线圆点 */}
                  <span
                    className="absolute -left-4 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--surface)]"
                    style={{ background: opColor }}
                    aria-hidden="true"
                  />
                  <div className="px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
                        style={{
                          color: opColor,
                          background: "var(--surface-2)",
                        }}
                      >
                        {t(getActionLabelKey(op.action))}
                      </span>
                      <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                        {operator}
                      </span>
                      {op.nodeName && (
                        <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                          · {op.nodeName}
                        </span>
                      )}
                      <span className="text-[length:var(--text-xs)] text-[var(--muted)] ml-auto">
                        {new Date(op.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {op.comment && (
                      <p className="mt-1.5 text-[length:var(--text-sm)] text-[var(--fg-2)] whitespace-pre-wrap break-words flex gap-1.5">
                        <CornerDownRight
                          size={13}
                          className="shrink-0 mt-0.5 text-[var(--muted)]"
                        />
                        <span>{op.comment}</span>
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* 操作按钮 */}
      {(canApproveOrReject || canWithdraw) && (
        <section className="flex items-center gap-2 pt-[var(--space-3)] border-t border-[var(--border-soft)]">
          {canApproveOrReject && (
            <button
              onClick={() =>
                setActionDialog({
                  type: "approve",
                  confirmKey: "confirmApprove",
                })
              }
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--success)] text-[var(--success-fg, #fff)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 transition-opacity duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <CheckCircle2 size={14} />
              {t("approve")}
            </button>
          )}
          {canApproveOrReject && (
            <button
              onClick={() =>
                setActionDialog({
                  type: "reject",
                  confirmKey: "confirmReject",
                })
              }
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--danger)] text-[var(--danger-fg, #fff)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:opacity-90 transition-opacity duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <XCircle size={14} />
              {t("reject")}
            </button>
          )}
          {canWithdraw && (
            <button
              onClick={() =>
                setActionDialog({
                  type: "withdraw",
                  confirmKey: "confirmWithdraw",
                })
              }
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              <MinusCircle size={14} />
              {t("withdraw")}
            </button>
          )}
        </section>
      )}

      {/* 操作确认弹窗 */}
      {actionDialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            setActionDialog(null);
          }}
        >
          <div className="w-full max-w-md my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
            <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
              <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t(actionDialog.confirmKey)}
              </h2>
              <button
                type="button"
                onClick={() => setActionDialog(null)}
                className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                aria-label={tButton("close")}
              >
                <X size={16} />
              </button>
            </header>
            <form onSubmit={handleAction} className="px-5 py-4 space-y-3">
              <div>
                <label
                  className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5"
                  htmlFor="approval-comment"
                >
                  {t("comment")}
                </label>
                <textarea
                  id="approval-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder={t("commentPlaceholder")}
                  className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
                />
              </div>
              {actionError && (
                <p className="text-[length:var(--text-sm)] text-[var(--danger)]">
                  {actionError}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setActionDialog(null)}
                  className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  {tButton("cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  {submitting && (
                    <Loader2 size={14} className="animate-spin" />
                  )}
                  {tButton("confirm")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ApprovalDetail;