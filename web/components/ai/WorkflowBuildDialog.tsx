"use client";

/**
 * AI 工作流构建弹窗 —— 用户输入自然语言描述，调用 /api/v1/ai/workflow-build
 * 生成工作流定义，预览后确认创建（POST /api/v1/workspaces/{wid}/workflows）。
 *
 * 交互流程：
 *  1. 输入自然语言描述，点击「生成」
 *  2. AI 返回工作流定义，展示预览（name/description/trigger/actions）
 *  3. 「确认创建」→ POST /api/v1/workspaces/{wid}/workflows
 *  4. 成功后 Toast + onCreated + onClose
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, X, Loader2, Zap, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

interface WorkflowAction {
  type: string;
  config: Record<string, unknown>;
  order: number;
}

interface WorkflowDefinition {
  name: string;
  description: string;
  trigger: { event: string; conditions: Record<string, unknown> };
  actions: WorkflowAction[];
}

const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

export default function WorkflowBuildDialog({
  wid,
  onClose,
  onCreated,
}: {
  wid: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const t = useTranslations("ai.workflowBuild");
  const tButton = useTranslations("button");
  const { toast } = useToast();

  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // AbortController：组件卸载时中止进行中的请求
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ── Escape 关闭 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting, loading]);

  async function generate() {
    if (loading || !description.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    setWorkflow(null);
    try {
      const result = await api<WorkflowDefinition>("/api/v1/ai/workflow-build", {
        method: "POST",
        body: JSON.stringify({ wid, description: description.trim() }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setWorkflow(result);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      // 不直接显示后端 error.message，用 i18n 错误提示
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }

  async function confirmCreate() {
    if (submitting || !workflow) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSubmitting(true);
    try {
      await api(`/api/v1/workspaces/${wid}/workflows`, {
        method: "POST",
        body: JSON.stringify({
          name: workflow.name,
          description: workflow.description || undefined,
          trigger: workflow.trigger,
          actions: workflow.actions,
        }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      toast("success", t("createSuccess"));
      onCreated?.();
      onClose();
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      // 不直接显示后端 error.message，用 i18n 错误提示
      toast("error", t("createFailed"));
    } finally {
      if (!ac.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-workflow-build-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!submitting && !loading) onClose();
      }}
    >
      <div className="w-full max-w-2xl my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        {/* ── 头部 ── */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="ai-workflow-build-title"
            className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            <Sparkles size={16} className="text-[var(--accent)]" />
            {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || loading}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        {/* ── 正文 ── */}
        <div className="px-5 py-4 space-y-[var(--space-3)]">
          {/* 描述输入框 */}
          <div>
            <label
              className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
              htmlFor="wf-build-desc"
            >
              {t("descriptionLabel")}
            </label>
            <textarea
              id="wf-build-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t("descriptionPlaceholder")}
              disabled={loading || submitting}
              className={`${fieldControl} resize-y`}
            />
          </div>

          {/* 生成按钮 */}
          <button
            type="button"
            onClick={generate}
            disabled={loading || submitting || !description.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("generating")}
              </>
            ) : (
              <>
                <Zap size={14} />
                {t("generate")}
              </>
            )}
          </button>

          {/* 错误态 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
                aria-label={tButton("close")}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* 预览态 */}
          {workflow && (
            <div className="space-y-[var(--space-3)]">
              <h3 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                <Check size={14} className="text-[var(--success-fg)]" />
                {t("preview")}
              </h3>

              {/* 名称 + 描述 */}
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] space-y-2">
                <div>
                  <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                    {t("name")}
                  </span>
                  <p className="text-[length:var(--text-sm)] text-[var(--fg)] mt-0.5">
                    {workflow.name}
                  </p>
                </div>
                {workflow.description && (
                  <div>
                    <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                      {t("description")}
                    </span>
                    <p className="text-[length:var(--text-sm)] text-[var(--muted)] mt-0.5">
                      {workflow.description}
                    </p>
                  </div>
                )}
              </div>

              {/* 触发器 */}
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap size={14} className="text-[var(--accent)]" />
                  <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                    {t("trigger")}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="text-[length:var(--text-sm)]">
                    <span className="text-[var(--muted)]">{t("event")}：</span>
                    <code className="text-[var(--accent)] font-mono text-[length:var(--text-xs)]">
                      {workflow.trigger.event}
                    </code>
                  </div>
                  {Object.keys(workflow.trigger.conditions).length > 0 && (
                    <div className="text-[length:var(--text-sm)]">
                      <span className="text-[var(--muted)]">{t("conditions")}：</span>
                      <code className="text-[var(--fg-2)] font-mono text-[length:var(--text-xs)]">
                        {JSON.stringify(workflow.trigger.conditions)}
                      </code>
                    </div>
                  )}
                </div>
              </div>

              {/* 动作列表 */}
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                    {t("actions")}
                  </span>
                </div>
                {workflow.actions.length === 0 ? (
                  <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
                    {t("noActions")}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {workflow.actions.map((action, idx) => (
                      <li
                        key={`${action.type}_${action.order}_${idx}`}
                        className="flex items-start gap-2 text-[length:var(--text-sm)]"
                      >
                        <span className="shrink-0 mt-0.5 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                          {idx + 1}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <code className="text-[var(--accent)] font-mono text-[length:var(--text-xs)]">
                            {action.type}
                          </code>
                          {Object.keys(action.config).length > 0 && (
                            <code className="block mt-0.5 text-[var(--fg-2)] font-mono text-[length:var(--text-xs)] break-all">
                              {JSON.stringify(action.config)}
                            </code>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── 底部操作栏 ── */}
        {workflow && (
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
              disabled={submitting}
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