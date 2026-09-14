"use client";

/**
 * TemplateApplyDialog · 应用模板弹窗
 *
 * 功能：
 *  - 显示模板任务预览（只读列表）
 *  - 可选指定里程碑 / 负责人（下拉，从工作区拉取）
 *  - 确认后调 POST /project-templates/{tid}/apply 批量创建任务
 *  - 成功后提示创建数量并关闭
 *
 * 样式全部走 design token，图标 lucide-react（size 14/16）。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Flag, Milestone as MilestoneIcon, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { TemplateListItem } from "./TemplateList";

interface Person {
  id: string;
  name: string | null;
  email: string;
}

interface Milestone {
  id: string;
  name: string;
  dueDate: string | null;
}

interface TemplateApplyDialogProps {
  wid: string;
  template: TemplateListItem | null;
  open: boolean;
  onClose: () => void;
  /** 应用成功后回调 */
  onApplied?: (count: number) => void;
}

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export function TemplateApplyDialog({ wid, template, open, onClose, onApplied }: TemplateApplyDialogProps) {
  const t = useTranslations("projectTemplate");
  const tPriority = useTranslations("priority");
  const tButton = useTranslations("button");
  const tMilestone = useTranslations("milestone");

  const [members, setMembers] = useState<Person[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestoneId, setMilestoneId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [successCount, setSuccessCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !template) return;
    setMilestoneId("");
    setAssigneeId("");
    setError("");
    setSuccessCount(null);
    Promise.all([
      api<Person[]>(`/api/v1/workspaces/${wid}/members`).catch(() => [] as Person[]),
      api<Milestone[]>(`/api/v1/workspaces/${wid}/milestones`).catch(() => [] as Milestone[]),
    ]).then(([m, ms]) => {
      setMembers(m);
      setMilestones(ms);
    });
  }, [open, template, wid]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !template) return null;

  const tasks = Array.isArray(template.templateData?.tasks)
    ? (template.templateData.tasks as { title: string; description?: string; priority?: string }[])
    : [];

  async function handleApply() {
    if (!template || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await api<{ count: number; taskIds: string[] }>(
        `/api/v1/workspaces/${wid}/project-templates/${template.id}/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            milestoneId: milestoneId || null,
            assigneeId: assigneeId || undefined,
          }),
        },
      );
      setSuccessCount(res.count);
      onApplied?.(res.count);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("applyFailed");
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpl-apply-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        handleClose();
      }}
    >
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="tpl-apply-title"
            className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            {t("applyTemplate")}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-4 sm:px-5 py-4 space-y-4">
          {/* 模板名 */}
          <div>
            <p className="text-[length:var(--text-xs)] text-[var(--meta)]">{t("name")}</p>
            <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
              {template.name}
            </p>
          </div>

          {/* 成功提示 */}
          {successCount !== null ? (
            <div className="flex items-center gap-2 px-3 py-3 rounded-[var(--radius-md)] bg-[var(--success-soft)] text-[var(--success-fg)] text-[length:var(--text-sm)]">
              <CheckCircle2 size={16} />
              <span>{t("applySuccess", { count: successCount })}</span>
            </div>
          ) : (
            <>
              {/* 任务预览 */}
              <div>
                <label className={fieldLabel}>{t("applyPreview")}</label>
                {tasks.length === 0 ? (
                  <p className="text-[length:var(--text-sm)] text-[var(--meta)]">{t("noTasks")}</p>
                ) : (
                  <ul className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {tasks.map((tk, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 p-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)] border border-[var(--border-soft)]"
                      >
                        <Flag size={12} className="shrink-0 mt-0.5 text-[var(--meta)]" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[length:var(--text-sm)] text-[var(--fg)] truncate">
                            {tk.title}
                          </p>
                          {tk.priority && (
                            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
                              {tPriority(tk.priority)}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 里程碑 + 负责人 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={fieldLabel}>
                    <MilestoneIcon size={13} />
                    {t("milestone")}
                  </label>
                  <select
                    value={milestoneId}
                    onChange={(e) => setMilestoneId(e.target.value)}
                    className={fieldControl}
                  >
                    <option value="">{tMilestone("filterUnassigned")}</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.dueDate ? `（${new Date(m.dueDate).toLocaleDateString()}）` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={fieldLabel}>{t("assignee")}</label>
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className={fieldControl}
                  >
                    <option value="">{t("unassigned")}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
                  <span className="flex-1">{error}</span>
                  <button
                    type="button"
                    onClick={() => setError("")}
                    className="shrink-0 opacity-60 hover:opacity-100 transition-opacity rounded-[var(--radius-sm)]"
                    aria-label={tButton("close")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            >
              {successCount !== null ? tButton("close") : tButton("cancel")}
            </button>
            {successCount === null && (
              <button
                type="button"
                onClick={handleApply}
                disabled={tasks.length === 0 || submitting}
                className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {t("apply")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}