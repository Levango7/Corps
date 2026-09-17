"use client";

/**
 * 目标详情面板（侧栏）。
 * 含关键结果列表，每个 KR 显示进度、当前值/目标值、单位、权重、负责人、截止日期。
 * 支持添加/编辑/删除 KR，删除目标。
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { X, Plus, Pencil, Trash2, Loader2, Calendar, User } from "lucide-react";
import { api } from "@/lib/api";
import { toLocalDateString } from "@/lib/date";
import KeyResultEditor, { type KeyResult } from "./KeyResultEditor";

export type ObjectiveStatus = "draft" | "active" | "completed" | "archived";

export interface ObjectiveDetailData {
  id: string;
  title: string;
  description: string | null;
  ownerId: string | null;
  period: string;
  status: ObjectiveStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string | null; email: string } | null;
  keyResults: KeyResult[];
}

const STATUS_COLORS: Record<ObjectiveStatus, string> = {
  draft: "var(--muted)",
  active: "var(--accent)",
  completed: "var(--success)",
  archived: "var(--meta)",
};

export function ObjectiveDetailPanel({
  wid,
  oid,
  onClose,
  onChanged,
}: {
  wid: string;
  oid: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("okr");
  const tButton = useTranslations("button");
  const [obj, setObj] = useState<ObjectiveDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [krEditorOpen, setKrEditorOpen] = useState(false);
  const [editingKr, setEditingKr] = useState<KeyResult | null>(null);
  const [editing, setEditing] = useState(false);

  async function fetchDetail() {
    setLoading(true);
    setError("");
    try {
      const data = await api<ObjectiveDetailData>(
        `/api/v1/workspaces/${wid}/objectives/${oid}`,
      );
      setObj(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("noObjectives"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, oid]);

  async function deleteObjective() {
    if (!obj) return;
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api(`/api/v1/workspaces/${wid}/objectives/${oid}`, {
        method: "DELETE",
      });
      onChanged?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("delete"));
    }
  }

  async function deleteKr(krid: string) {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api(
        `/api/v1/workspaces/${wid}/objectives/${oid}/key-results/${krid}`,
        { method: "DELETE" },
      );
      await fetchDetail();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("delete"));
    }
  }

  return (
    <div className="flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)]">
      {/* 头部 */}
      <header className="flex items-center justify-between px-[var(--space-4)] py-3 border-b border-[var(--border-soft)]">
        <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
          {t("objective")}
        </h2>
        <div className="flex items-center gap-1">
          {obj && (
            <button
              onClick={deleteObjective}
              className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              aria-label={t("delete")}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin" />
        </div>
      ) : error ? (
        <div className="px-[var(--space-4)] py-3 text-[length:var(--text-sm)] text-[var(--danger)]">
          {error}
        </div>
      ) : obj ? (
        <div className="px-[var(--space-4)] py-[var(--space-3)] space-y-[var(--space-4)]">
          {/* 目标信息 */}
          <div>
            <div className="flex items-start gap-2">
              <h3 className="flex-1 text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {obj.title}
              </h3>
              <button
                onClick={() => setEditing(true)}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                aria-label={t("editObjective")}
              >
                <Pencil size={14} />
              </button>
            </div>
            {obj.description && (
              <p className="mt-1 text-[length:var(--text-sm)] text-[var(--fg-2)] whitespace-pre-wrap">
                {obj.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[length:var(--text-xs)]">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--fg-2)]">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: STATUS_COLORS[obj.status] }}
              />
              {t(obj.status)}
            </span>
            <span className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--fg-2)] tabular-nums">
              {obj.period}
            </span>
            {obj.owner && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--fg-2)]">
                <User size={12} />
                {obj.owner.name || obj.owner.email}
              </span>
            )}
          </div>

          {/* 进度条 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                {t("progress")}
              </span>
              <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] tabular-nums">
                {Math.round(obj.progress)}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{ width: `${Math.round(obj.progress)}%` }}
              />
            </div>
          </div>

          {/* 关键结果列表 */}
          <div>
            <div className="flex items-center justify-between mb-[var(--space-2)]">
              <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                {t("keyResults")}
              </span>
              <button
                onClick={() => {
                  setEditingKr(null);
                  setKrEditorOpen(true);
                }}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] text-[var(--accent)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <Plus size={14} />
                {t("addKeyResult")}
              </button>
            </div>

            {obj.keyResults.length === 0 ? (
              <p className="text-[length:var(--text-sm)] text-[var(--muted)] py-[var(--space-3)]">
                {t("noObjectives")}
              </p>
            ) : (
              <ul className="space-y-[var(--space-2)]">
                {obj.keyResults.map((kr) => {
                  const krProgress =
                    kr.targetValue === 0
                      ? 0
                      : Math.max(0, Math.min(100, (kr.currentValue / kr.targetValue) * 100));
                  return (
                    <li
                      key={kr.id}
                      className="px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                          {kr.title}
                        </span>
                        <button
                          onClick={() => {
                            setEditingKr(kr);
                            setKrEditorOpen(true);
                          }}
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                          aria-label={t("edit")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteKr(kr.id)}
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                          aria-label={t("delete")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--text-xs)] text-[var(--meta)]">
                        <span className="tabular-nums">
                          {kr.currentValue}/{kr.targetValue}
                          {kr.unit ? ` ${kr.unit}` : ""}
                        </span>
                        <span>·</span>
                        <span>
                          {t("weight")}: {kr.weight}
                        </span>
                        {kr.owner && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <User size={11} />
                              {kr.owner.name || kr.owner.email}
                            </span>
                          </>
                        )}
                        {kr.dueDate && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <Calendar size={11} />
                              {toLocalDateString(new Date(kr.dueDate))}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${Math.round(krProgress)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <KeyResultEditor
        wid={wid}
        oid={oid}
        kr={editingKr}
        open={krEditorOpen}
        onClose={() => setKrEditorOpen(false)}
        onSaved={() => {
          fetchDetail();
          onChanged?.();
        }}
      />

      {obj && editing && (
        <EditObjectiveDialog
          wid={wid}
          oid={oid}
          initial={{
            title: obj.title,
            description: obj.description,
            period: obj.period,
            status: obj.status,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            fetchDetail();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

/** 编辑目标弹窗（内联，复用新建目标表单结构，改为 PATCH 调用） */
function EditObjectiveDialog({
  wid,
  oid,
  initial,
  onClose,
  onSaved,
}: {
  wid: string;
  oid: string;
  initial: {
    title: string;
    description: string | null;
    period: string;
    status: ObjectiveStatus;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("okr");
  const tButton = useTranslations("button");
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [period, setPeriod] = useState(initial.period);
  const [status, setStatus] = useState<ObjectiveStatus>(initial.status);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fieldLabel =
    "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
  const fieldControl =
    "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !period.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/objectives/${oid}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          period: period.trim(),
          status,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("editObjective"));
    } finally {
      setSubmitting(false);
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
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("editObjective")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          <div>
            <label className={fieldLabel} htmlFor="edit-obj-title">
              {t("title_")}
            </label>
            <input
              id="edit-obj-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className={`${fieldControl} h-10`}
            />
          </div>

          <div>
            <label className={fieldLabel} htmlFor="edit-obj-desc">
              {t("description")}
            </label>
            <textarea
              id="edit-obj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="edit-obj-period">
                {t("period")}
              </label>
              <input
                id="edit-obj-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2026-Q1"
                maxLength={20}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="edit-obj-status">
                {t("status")}
              </label>
              <select
                id="edit-obj-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ObjectiveStatus)}
                className={fieldControl}
              >
                <option value="draft">{t("draft")}</option>
                <option value="active">{t("active")}</option>
                <option value="completed">{t("completed")}</option>
                <option value="archived">{t("archived")}</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !period.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {tButton("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}