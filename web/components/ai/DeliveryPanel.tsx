"use client";

/**
 * AI 交付面板（AI 交付域第一竖切）：
 *  - 提交表单：主题/需求 + 流水线选择（docgen 系 6 档）→ POST /api/v1/ai/deliverables
 *  - 任务列表：GET 轮询（10s），显示「排队/生成中/已完成/失败」阶段
 *  - 详情展开：GET /deliverables/<id>，展示交付内容（output_content）
 *
 * nexusloom 的 DAG 藏在 sidecar 内部——用户只看到阶段条与交付物，
 * 这正是 nexusloom 定位讨论确定的「不可见 AI 交付运行时」语义。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Loader2, PackageCheck, RefreshCw, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

/** 库内落库形态（第二竖切起列表/详情按 corps 侧记录展示） */
interface DeliverableRow {
  id: string;
  taskId: string;
  title: string;
  pipeline: string;
  status: string;
  createdAt: string | null;
  finishedAt: string | null;
  outputPath: string | null;
  /** 交付后审批态（null=待审批） */
  approvalStatus?: string | null;
  /** 送审到 corps approvals 引擎后的实例关联（null=未送审） */
  approvalInstanceId?: string | null;
}

interface DeliverableDetail extends DeliverableRow {
  outputContent: string | null;
  error: string | null;
  /** sidecar 人审闸门等待信息（有值时任务尚未产出，需先到 approvals 页放行） */
  awaitingApproval?: {
    nodes?: string[];
    messages?: Record<string, string>;
    pipeline?: string;
  } | null;
}

const PIPELINES = [
  "docgen",
  "docgen-lean",
  "docgen-verified",
  "docgen-render",
  "docgen-review",
  "kb-docgen",
] as const;

export default function DeliveryPanel({ wid }: { wid: string }) {
  const t = useTranslations("ai.delivery");
  const [query, setQuery] = useState("");
  const [pipeline, setPipeline] = useState<string>("docgen");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [tasks, setTasks] = useState<DeliverableRow[] | null>(null);
  const [listError, setListError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeliverableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 送审到 corps approvals 引擎（完整审批流，审批人在 approvals 页操作）。 */
  async function handleSubmitApproval(row: DeliverableRow) {
    if (approvingId) return;
    setApprovingId(row.id);
    try {
      await api<unknown>(
        `/api/v1/ai/deliverables/${encodeURIComponent(row.id)}/submit-approval?wid=${encodeURIComponent(wid)}`,
        { method: "POST" },
      );
      await loadList();
    } catch (e) {
      setListError(e instanceof Error ? e.message : t("error"));
    } finally {
      setApprovingId(null);
    }
  }

  /** 交付后审批（通过/驳回；驳回弹原因框）。成功后刷新列表。 */
  async function handleApproval(row: DeliverableRow, action: "approve" | "reject") {
    if (approvingId) return;
    let note: string | undefined;
    if (action === "reject") {
      const input = window.prompt(t("approvalNotePrompt"));
      if (!input || !input.trim()) return;
      note = input.trim();
    }
    setApprovingId(row.id);
    try {
      await api<unknown>(
        `/api/v1/ai/deliverables/${encodeURIComponent(row.id)}/approve?wid=${encodeURIComponent(wid)}`,
        {
          method: "POST",
          body: JSON.stringify({ action, ...(note ? { note } : {}) }),
        },
      );
      await loadList();
    } catch (e) {
      setListError(e instanceof Error ? e.message : t("error"));
    } finally {
      setApprovingId(null);
    }
  }

  const loadList = useCallback(async () => {
    try {
      const data = await api<{ items: DeliverableRow[]; total: number }>(
        `/api/v1/ai/deliverables?wid=${encodeURIComponent(wid)}`,
      );
      setTasks(data.items);
      setListError("");
    } catch (e) {
      setListError(e instanceof Error ? e.message : t("error"));
    }
  }, [wid, t]);

  useEffect(() => {
    loadList();
    timerRef.current = setInterval(loadList, 10_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loadList]);

  async function handleSubmit() {
    if (submitting || !query.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      // 提交后不消费响应体（taskId 由轮询列表自然带出，避免与列表端点键形混淆）
      await api<unknown>("/api/v1/ai/deliverables", {
        method: "POST",
        body: JSON.stringify({ wid, query: query.trim(), pipeline }),
      });
      setQuery("");
      await loadList();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t("error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await api<DeliverableDetail>(
        `/api/v1/ai/deliverables/${encodeURIComponent(id)}?wid=${encodeURIComponent(wid)}`,
      );
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function statusLabel(status: string): string {
    const s = status.toLowerCase();
    if (s.includes("awaiting_approval") || s === "paused") return t("statusAwaitingApproval");
    if (s.includes("done") || s.includes("complet")) return t("statusDone");
    if (s.includes("fail") || s.includes("error")) return t("statusFailed");
    if (s.includes("pend") || s.includes("queue")) return t("statusQueued");
    return t("statusRunning");
  }

  function statusColor(status: string): string {
    const s = status.toLowerCase();
    if (s.includes("awaiting_approval") || s === "paused") return "text-[var(--accent)]";
    if (s.includes("done") || s.includes("complet")) return "text-[var(--success-fg)]";
    if (s.includes("fail") || s.includes("error")) return "text-[var(--danger-fg)]";
    return "text-[var(--muted)]";
  }

  const inputCls =
    "w-full px-2.5 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";
  const btnCls =
    "flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--accent-fg)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="space-y-[var(--space-4)]" aria-label={t("title")}>
      {/* ── 提交表单 ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)] p-4 space-y-3">
        <h3 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <FileText size={14} className="text-[var(--accent)]" />
          {t("newTask")}
        </h3>
        <textarea
          aria-label={t("queryLabel")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder={t("queryPlaceholder")}
          className={inputCls}
        />
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label={t("pipelineLabel")}
            value={pipeline}
            onChange={(e) => setPipeline(e.target.value)}
            className={`${inputCls} max-w-[240px]`}
          >
            {PIPELINES.map((p) => (
              <option key={p} value={p}>
                {t(`pipeline_${p.replace("-", "_")}` as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !query.trim()}
            className={btnCls}
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PackageCheck size={14} />
            )}
            {submitting ? t("submitting") : t("submit")}
          </button>
        </div>
        {submitError && (
          <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--danger-fg)]">
            <AlertCircle size={14} className="shrink-0" />
            {submitError}
          </div>
        )}
      </div>

      {/* ── 任务列表 ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)] p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("tasksTitle")}
          </h3>
          <button
            type="button"
            onClick={loadList}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            aria-label={t("refresh")}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {listError ? (
          <div className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--muted)] py-4">
            <AlertCircle size={14} className="shrink-0" />
            {t("sidecarDown")}
          </div>
        ) : tasks === null ? (
          <div className="flex items-center justify-center py-6 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            {t("loading")}
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-6 text-center text-[var(--muted)] text-[length:var(--text-sm)]">
            {t("empty")}
          </div>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => handleExpand(task.id)}
                  className="w-full flex items-center gap-2 text-left"
                  aria-expanded={expandedId === task.id}
                >
                  <span
                    className={`text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] shrink-0 ${statusColor(task.status)}`}
                  >
                    {statusLabel(task.status)}
                  </span>
                  <span className="text-[length:var(--text-sm)] text-[var(--fg)] truncate flex-1">
                    {task.title}
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--muted)] shrink-0">
                    {task.pipeline}
                  </span>
                  <span className="text-[length:var(--text-xs)] text-[var(--muted)] shrink-0">
                    {task.createdAt ? new Date(task.createdAt).toLocaleString() : ""}
                  </span>
                </button>
                {expandedId === task.id && (
                  <div className="mt-2 pt-2 border-t border-[var(--border-soft)] space-y-2">
                    {detailLoading ? (
                      <div className="flex items-center gap-2 text-[var(--muted)] text-[length:var(--text-sm)]">
                        <Loader2 size={14} className="animate-spin" />
                        {t("loading")}
                      </div>
                    ) : detail ? (
                      <>
                        {detail.error && (
                          <p className="text-[length:var(--text-sm)] text-[var(--danger-fg)]">
                            {detail.error}
                          </p>
                        )}
                        {detail.outputContent ? (
                          <pre className="whitespace-pre-wrap text-[length:var(--text-sm)] text-[var(--fg)] max-h-72 overflow-auto rounded-[var(--radius-md)] bg-[var(--surface)] p-3 border border-[var(--border-soft)]">
                            {detail.outputContent}
                          </pre>
                        ) : (
                          <p className="text-[length:var(--text-xs)] text-[var(--muted)]">
                            {t("noOutputYet")}
                          </p>
                        )}
                        {detail.outputPath && (
                          <p className="text-[length:var(--text-xs)] text-[var(--muted)] break-all">
                            {t("outputPath")}: {detail.outputPath}
                          </p>
                        )}
                        {detail.status.toLowerCase().includes("done") && detail.outputPath && (
                          <a
                            href={`/api/v1/ai/deliverables/${encodeURIComponent(detail.id)}/download?wid=${encodeURIComponent(wid)}`}
                            className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--accent)] hover:underline"
                          >
                            {t("download")}
                          </a>
                        )}
                        {/* 已送审但尚未裁决：只允许去标准审批页操作，不能再走自含审批绕过流程。 */}
                        {detail.approvalInstanceId && !detail.approvalStatus && (
                          <div className="flex items-center gap-2 pt-1">
                            <span className="text-[length:var(--text-xs)] text-[var(--accent)]">
                              {t("pendingApproval")}
                            </span>
                            <a
                              href={`/w/${wid}/approvals/instances/${detail.approvalInstanceId}`}
                              className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--accent)] hover:underline"
                            >
                              {t("approvalInstanceLink")}
                            </a>
                          </div>
                        )}
                        {/* 交付后审批（已完成才有动作；已有结论显示徽标，重复审批服务端 409） */}
                        {detail.status.toLowerCase().includes("done") &&
                          (detail.approvalStatus || !detail.approvalInstanceId) && (
                          <div className="flex items-center gap-2 pt-1">
                            {detail.approvalStatus ? (
                              <span
                                className={`text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] ${
                                  detail.approvalStatus === "approved"
                                    ? "text-[var(--success-fg)]"
                                    : "text-[var(--danger-fg)]"
                                }`}
                              >
                                {detail.approvalStatus === "approved"
                                  ? t("approved")
                                  : t("rejected")}
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleApproval(detail, "approve")}
                                  disabled={approvingId === detail.id}
                                  className="px-2.5 py-1 rounded-[var(--radius-md)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--accent-fg)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
                                >
                                  {approvingId === detail.id ? t("approving") : t("approve")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleApproval(detail, "reject")}
                                  disabled={approvingId === detail.id}
                                  className="px-2.5 py-1 rounded-[var(--radius-md)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--danger-fg)] bg-[var(--danger-soft)] hover:opacity-80 disabled:opacity-50"
                                >
                                  {t("reject")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSubmitApproval(detail)}
                                  disabled={approvingId === detail.id}
                                  className="px-2.5 py-1 rounded-[var(--radius-md)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--accent)] bg-[var(--surface-2)] border border-[var(--border-soft)] hover:opacity-80 disabled:opacity-50"
                                >
                                  {t("submitApproval")}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
                        {t("error")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
