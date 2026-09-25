"use client";

/**
 * 工作流执行历史列表。
 *
 * 显示状态/触发数据/结果/时间，
 * 支持手动触发执行。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Play, Loader2, AlertCircle, History } from "lucide-react";
import { api } from "@/lib/api";
import type { WorkflowItem } from "./WorkflowList";

export interface WorkflowExecutionItem {
  id: string;
  workflowId: string;
  triggerData: unknown;
  status: string;
  result: unknown;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface WorkflowExecutionListProps {
  wid: string;
  workflow: WorkflowItem;
  onClose: () => void;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--muted)",
  running: "var(--warning)",
  completed: "var(--success)",
  failed: "var(--danger)",
};

export function WorkflowExecutionList({ wid, workflow, onClose }: WorkflowExecutionListProps) {
  const t = useTranslations("workflow");
  const [items, setItems] = useState<WorkflowExecutionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: WorkflowExecutionItem[]; total: number }>(
          `/api/v1/workspaces/${wid}/workflows/${workflow.id}/executions`,
        );
        if (!cancelled) setItems(data.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wid, workflow.id, t]);

  async function triggerExecution() {
    if (triggering) return;
    setTriggering(true);
    setError("");
    try {
      const exec = await api<WorkflowExecutionItem>(
        `/api/v1/workspaces/${wid}/workflows/${workflow.id}/executions`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setItems((prev) => [exec, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("executeFailed"));
    } finally {
      setTriggering(false);
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case "pending":
        return t("pending");
      case "running":
        return t("running");
      case "completed":
        return t("completed");
      case "failed":
        return t("failed");
      default:
        return status;
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-2xl my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] flex items-center gap-2">
            <History size={16} />
            {workflow.name} · {t("executions")}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={triggerExecution}
              disabled={triggering}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
            >
              {triggering ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {t("execute")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              aria-label={t("close")}
            >
              {"\u2715"}
            </button>
          </div>
        </header>

        <div className="px-4 sm:px-5 py-4">
          {error && (
            <div className="flex items-start gap-2 mb-[var(--space-4)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
              <Loader2 size={20} className="inline animate-spin mr-2" />
              {t("loading")}
            </div>
          ) : items.length === 0 ? (
            <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
              <History size={36} className="mx-auto mb-3 opacity-50" />
              <p>{t("noExecutions")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
              {items.map((exec) => (
                <li key={exec.id} className="px-[var(--space-4)] py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: STATUS_COLOR[exec.status] ?? "var(--muted)" }}
                    />
                    <span className="flex-1 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                      {statusLabel(exec.status)}
                    </span>
                    <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                      {new Date(exec.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 ml-3.5 text-[length:var(--text-xs)] text-[var(--meta)] space-y-0.5">
                    <div>
                      {t("trigger")}:{" "}
                      <code className="font-mono text-[var(--fg-2)]">
                        {JSON.stringify(exec.triggerData).slice(0, 100)}
                      </code>
                    </div>
                    {exec.result != null && (
                      <div>
                        {t("result")}:{" "}
                        <code className="font-mono text-[var(--fg-2)]">
                          {JSON.stringify(exec.result).slice(0, 100)}
                        </code>
                      </div>
                    )}
                    {exec.startedAt && (
                      <div>
                        {t("startedAt")}: {new Date(exec.startedAt).toLocaleString()}
                      </div>
                    )}
                    {exec.completedAt && (
                      <div>
                        {t("completedAt")}: {new Date(exec.completedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
