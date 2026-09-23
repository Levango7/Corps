"use client";

/**
 * 工作流列表组件。
 *
 * 显示名称/描述/状态/触发器摘要/最近执行状态，
 * 支持启用/禁用切换、编辑、删除、查看执行历史。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Workflow as WorkflowIcon,
  Plus,
  Loader2,
  Power,
  Pencil,
  Trash2,
  History,
  AlertCircle,
  MoreVertical,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

export interface WorkflowItem {
  id: string;
  name: string;
  description: string | null;
  trigger: unknown;
  actions: unknown;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowListProps {
  wid: string;
  onCreate: () => void;
  onEdit: (wf: WorkflowItem) => void;
  onShowExecutions: (wf: WorkflowItem) => void;
  /** 外部递增此 key 以触发刷新 */
  refreshKey: number;
}

export function WorkflowList({ wid, onCreate, onEdit, onShowExecutions, refreshKey }: WorkflowListProps) {
  const t = useTranslations("workflow");
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: WorkflowItem[]; total: number }>(
          `/api/v1/workspaces/${wid}/workflows`,
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
  }, [wid, refreshKey, t]);

  async function toggleActive(wf: WorkflowItem) {
    if (togglingId) return;
    setTogglingId(wf.id);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/workflows/${wf.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !wf.active }),
      });
      setItems((prev) => prev.map((w) => (w.id === wf.id ? { ...w, active: !w.active } : w)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("updateFailed"));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(wf: WorkflowItem) {
    if (deletingId) return;
    if (!window.confirm(t("confirmDelete"))) return;
    setDeletingId(wf.id);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/workflows/${wf.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((w) => w.id !== wf.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  /** 提取触发器摘要：尝试读取 trigger.event 字段 */
  function triggerSummary(trigger: unknown): string {
    if (trigger && typeof trigger === "object" && "event" in trigger) {
      return String((trigger as { event: unknown }).event);
    }
    return "—";
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("title")}
        </h1>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
        >
          <Plus size={14} />
          {t("create")}
        </button>
      </div>

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
          <WorkflowIcon size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noWorkflows")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((wf) => (
            <li key={wf.id} className="px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]">
              <div className="flex items-center gap-2">
                <WorkflowIcon size={15} className="shrink-0 text-[var(--muted)]" />
                <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                  {wf.name}
                </span>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 text-[length:var(--text-xs)] ${wf.active ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${wf.active ? "bg-[var(--success)]" : "bg-[var(--muted)]"}`}
                  />
                  {wf.active ? t("active") : t("inactive")}
                </span>
              </div>
              {wf.description && (
                <p className="mt-1 ml-6 text-[length:var(--text-xs)] text-[var(--meta)] truncate">{wf.description}</p>
              )}
              <div className="mt-1 ml-6 flex items-center gap-3 text-[length:var(--text-xs)] text-[var(--muted)]">
                <span>
                  {t("trigger")}: {triggerSummary(wf.trigger)}
                </span>
                <span>·</span>
                <span>{new Date(wf.updatedAt).toLocaleString()}</span>
              </div>
              <div className="mt-2 ml-6 flex items-center gap-1">
                {/* 启用/禁用 — 始终显示（手机端仅图标） */}
                <button
                  onClick={() => toggleActive(wf)}
                  disabled={togglingId === wf.id}
                  title={wf.active ? t("inactive") : t("active")}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                >
                  {togglingId === wf.id ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                  <span className="hidden sm:inline">{wf.active ? t("disable") : t("enable")}</span>
                </button>

                {/* 手机端次要操作下拉菜单 */}
                <div className="relative md:hidden">
                  <button
                    onClick={() => setMenuOpenId(menuOpenId === wf.id ? null : wf.id)}
                    className="inline-flex items-center justify-center h-7 w-7 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                    aria-label="More actions"
                  >
                    <MoreVertical size={14} />
                  </button>
                  {menuOpenId === wf.id && (
                    <>
                      <div
                        className="fixed inset-0 z-[var(--z-dropdown)]"
                        onClick={() => setMenuOpenId(null)}
                      />
                      <div className="absolute left-0 top-full mt-1 min-w-[140px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-md)] py-1 z-[calc(var(--z-dropdown)+1)]">
                        <button
                          onClick={() => {
                            onEdit(wf);
                            setMenuOpenId(null);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                        >
                          <Pencil size={14} />
                          {t("edit")}
                        </button>
                        <button
                          onClick={() => {
                            onShowExecutions(wf);
                            setMenuOpenId(null);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                        >
                          <History size={14} />
                          {t("executions")}
                        </button>
                        <button
                          onClick={() => {
                            handleDelete(wf);
                            setMenuOpenId(null);
                          }}
                          disabled={deletingId === wf.id}
                          className="flex items-center gap-2 w-full px-3 py-2 text-[length:var(--text-sm)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                        >
                          {deletingId === wf.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          {t("delete")}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* md 以上：全部按钮直接显示 */}
                <button
                  onClick={() => onEdit(wf)}
                  className="hidden md:inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <Pencil size={12} />
                  {t("edit")}
                </button>
                <button
                  onClick={() => onShowExecutions(wf)}
                  className="hidden md:inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <History size={12} />
                  {t("executions")}
                </button>
                <button
                  onClick={() => handleDelete(wf)}
                  disabled={deletingId === wf.id}
                  className="hidden md:inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                >
                  {deletingId === wf.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {t("delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}