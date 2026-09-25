"use client";

/**
 * AI 任务拆解弹窗 —— 调用 /api/v1/ai/task-breakdown 将任务拆解为子任务列表，
 * 用户可编辑/删除每条子任务，确认后批量创建为父任务的子任务。
 *
 * 交互流程：
 *  1. 打开即调用 AI 接口，显示 loading
 *  2. 返回后展示可编辑子任务列表（标题/描述/工时/优先级/删除）
 *  3. "确认创建" → 批量 POST /api/v1/workspaces/{wid}/tasks（parentId = taskId）
 *  4. 成功后 Toast + onCreated + onClose
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, X, Trash2, Plus, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";
import { FeedbackButtons } from "./FeedbackButtons";

type Priority = "low" | "medium" | "high" | "urgent";

interface Subtask {
  title: string;
  description: string;
  estimatedHours: number;
  priority: Priority;
  suggestedAssignee: string | null;
}

interface TaskBreakdownResult {
  subtasks: Subtask[];
  reasoning: string;
}

interface EditableSubtask extends Subtask {
  /** 前端临时 id，用于 React key */
  localId: string;
}

const PRIORITY_OPTS: { value: Priority; labelKey: string }[] = [
  { value: "low", labelKey: "low" },
  { value: "medium", labelKey: "medium" },
  { value: "high", labelKey: "high" },
  { value: "urgent", labelKey: "urgent" },
];

let _localId = 0;
function nextLocalId(): string {
  _localId += 1;
  return `local-${_localId}`;
}

const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export default function TaskBreakdownDialog({
  wid,
  taskId,
  taskTitle,
  onClose,
  onCreated,
}: {
  wid: string;
  taskId: string;
  taskTitle: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const t = useTranslations("ai.taskBreakdown");
  const tPriority = useTranslations("priority");
  const tButton = useTranslations("button");
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [subtasks, setSubtasks] = useState<EditableSubtask[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // AbortController：组件卸载时中止进行中的请求
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const abortRef = useRef<AbortController | null>(null);

  // ── 打开即调用 AI 拆解 ──
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    abortRef.current = ac;
    async function breakdown() {
      setLoading(true);
      setError("");
      try {
        const result = await api<TaskBreakdownResult>("/api/v1/ai/task-breakdown", {
          method: "POST",
          body: JSON.stringify({ taskTitle }),
          signal: ac.signal,
        });
        if (cancelled || ac.signal.aborted) return;
        setSubtasks(result.subtasks.map((s) => ({ ...s, localId: nextLocalId() })));
        setReasoning(result.reasoning);
      } catch {
        if (cancelled || ac.signal.aborted) return;
        if (e instanceof Error && e.name === "AbortError") return;
        // 不直接显示后端 error.message，用 i18n 错误提示
        setError(t("fetchFailed"));
      } finally {
        if (!cancelled && !ac.signal.aborted) setLoading(false);
      }
    }
    breakdown();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [taskTitle, t]);

  // ── Escape 关闭 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  function updateSubtask(localId: string, patch: Partial<EditableSubtask>) {
    setSubtasks((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  }

  function removeSubtask(localId: string) {
    setSubtasks((prev) => prev.filter((s) => s.localId !== localId));
  }

  function addBlankSubtask() {
    setSubtasks((prev) => [
      ...prev,
      {
        localId: nextLocalId(),
        title: "",
        description: "",
        estimatedHours: 0,
        priority: "medium",
        suggestedAssignee: null,
      },
    ]);
  }

  async function confirmCreate() {
    if (submitting) return;
    const valid = subtasks.filter((s) => s.title.trim());
    if (valid.length === 0) {
      toast("error", t("noSubtasks"));
      return;
    }
    setSubmitting(true);
    let created = 0;
    try {
      // 批量创建子任务（parentId = taskId），部分失败时提示已创建数量
      for (const s of valid) {
        await api(`/api/v1/workspaces/${wid}/tasks`, {
          method: "POST",
          body: JSON.stringify({
            title: s.title.trim(),
            description: s.description.trim() || undefined,
            priority: s.priority,
            parentId: taskId,
          }),
        });
        created++;
      }
      toast("success", t("createSuccess", { count: valid.length }));
      onCreated?.();
      onClose();
    } catch {
      // 部分失败：提示已创建数量（当前批次仅 1 个失败）
      if (created > 0) {
        toast("warning", t("partialCreateSuccess", { created, failed: 1 }));
        onCreated?.();
        onClose();
      } else {
        // 不直接显示后端 error.message，用 i18n 错误提示
        toast("error", t("createFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-task-breakdown-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!submitting) onClose();
      }}
    >
      <div className="w-full max-w-2xl my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        {/* ── 头部 ── */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="ai-task-breakdown-title"
            className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            <Sparkles size={16} className="text-[var(--accent)]" />
            {t("dialogTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        {/* ── 正文 ── */}
        <div className="px-5 py-4 space-y-[var(--space-3)]">
          {/* 源任务标题 */}
          <div className="text-[length:var(--text-sm)] text-[var(--muted)]">
            <span className="font-[weight:var(--weight-medium)]">{t("sourceTask")}：</span>
            <span className="text-[var(--fg)]">{taskTitle}</span>
          </div>

          {/* Loading 态 */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2
                size={28}
                className="animate-spin text-[var(--accent)]"
                aria-label={t("loading")}
              />
              <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{t("loading")}</p>
            </div>
          )}

          {/* 错误态 */}
          {!loading && error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
                aria-label={tButton("close")}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* 子任务列表 */}
          {!loading && !error && (
            <>
              {subtasks.length === 0 ? (
                <p className="text-[length:var(--text-sm)] text-[var(--muted)] py-6 text-center">
                  {t("emptySubtasks")}
                </p>
              ) : (
                <ul className="space-y-[var(--space-3)]">
                  {subtasks.map((s, idx) => (
                    <li
                      key={s.localId}
                      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
                    >
                      <div className="flex items-start gap-[var(--space-3)]">
                        <span className="shrink-0 mt-1.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                          {idx + 1}.
                        </span>
                        <div className="flex-1 min-w-0 space-y-2">
                          {/* 标题 */}
                          <input
                            type="text"
                            value={s.title}
                            onChange={(e) => updateSubtask(s.localId, { title: e.target.value })}
                            maxLength={255}
                            placeholder={t("titlePlaceholder")}
                            aria-label={t("titleLabel")}
                            className={`${fieldControl} font-[weight:var(--weight-medium)]`}
                          />
                          {/* 描述 */}
                          <textarea
                            value={s.description}
                            onChange={(e) =>
                              updateSubtask(s.localId, { description: e.target.value })
                            }
                            rows={2}
                            maxLength={2000}
                            placeholder={t("descriptionPlaceholder")}
                            aria-label={t("descriptionLabel")}
                            className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
                          />
                          {/* 工时 + 优先级 */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label
                                className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1"
                                htmlFor={`hours-${s.localId}`}
                              >
                                {t("estimatedHours")}
                              </label>
                              <input
                                id={`hours-${s.localId}`}
                                type="number"
                                min={0}
                                max={999}
                                step={0.5}
                                value={s.estimatedHours}
                                onChange={(e) =>
                                  updateSubtask(s.localId, {
                                    estimatedHours: Number(e.target.value) || 0,
                                  })
                                }
                                className={fieldControl}
                              />
                            </div>
                            <div>
                              <label
                                className="block text-[length:var(--text-xs)] text-[var(--muted)] mb-1"
                                htmlFor={`prio-${s.localId}`}
                              >
                                {t("priority")}
                              </label>
                              <select
                                id={`prio-${s.localId}`}
                                value={s.priority}
                                onChange={(e) =>
                                  updateSubtask(s.localId, {
                                    priority: e.target.value as Priority,
                                  })
                                }
                                className={fieldControl}
                              >
                                {PRIORITY_OPTS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {tPriority(o.labelKey)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                        {/* 删除按钮 */}
                        <button
                          type="button"
                          onClick={() => removeSubtask(s.localId)}
                          disabled={submitting}
                          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger-fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
                          aria-label={t("removeSubtask")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* 添加空白子任务 */}
              <button
                type="button"
                onClick={addBlankSubtask}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)] disabled:opacity-50"
              >
                <Plus size={14} />
                {t("addSubtask")}
              </button>

              {/* AI 推理说明 */}
              {reasoning && (
                <details className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)] px-[var(--space-3)] py-2">
                  <summary className="cursor-pointer text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]">
                    {t("reasoning")}
                  </summary>
                  <p className="mt-2 text-[length:var(--text-sm)] text-[var(--muted)] whitespace-pre-wrap">
                    {reasoning}
                  </p>
                </details>
              )}
            </>
          )}

          {/* AI 结果反馈按钮 */}
          {!loading && !error && subtasks.length > 0 && (
            <FeedbackButtons
              capability="task-breakdown"
              workspaceId={wid}
              originalOutput={subtasks}
            />
          )}
        </div>

        {/* ── 底部操作栏 ── */}
        {!loading && !error && (
          <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--border-soft)]">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            >
              {tButton("cancel")}
            </button>
            <button
              type="button"
              onClick={confirmCreate}
              disabled={submitting || subtasks.filter((s) => s.title.trim()).length === 0}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {t("confirmCreate")}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
