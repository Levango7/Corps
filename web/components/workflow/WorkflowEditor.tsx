"use client";

/**
 * 工作流编辑器弹窗。
 *
 * 编辑名称/描述/触发器配置/动作列表，
 * 触发器和动作以 JSON 文本形式编辑，提交时解析校验。
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { WorkflowItem } from "./WorkflowList";

interface WorkflowEditorProps {
  wid: string;
  /** 传入已有工作流则为编辑模式，null 为新建模式 */
  workflow: WorkflowItem | null;
  onClose: () => void;
  onSaved: () => void;
}

const fieldLabel = "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export function WorkflowEditor({ wid, workflow, onClose, onSaved }: WorkflowEditorProps) {
  const t = useTranslations("workflow");
  const isEdit = !!workflow;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerText, setTriggerText] = useState("");
  const [actionsText, setActionsText] = useState("");
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (workflow) {
      setName(workflow.name);
      setDescription(workflow.description ?? "");
      setTriggerText(JSON.stringify(workflow.trigger, null, 2));
      setActionsText(JSON.stringify(workflow.actions, null, 2));
      setActive(workflow.active);
    } else {
      setName("");
      setDescription("");
      setTriggerText(JSON.stringify({ event: "task.created" }, null, 2));
      setActionsText(JSON.stringify([{ type: "notify", config: {}, order: 1 }], null, 2));
      setActive(true);
    }
    setError("");
  }, [workflow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError("");

    // 解析 JSON 字段
    let trigger: unknown;
    let actions: unknown;
    try {
      trigger = JSON.parse(triggerText);
    } catch {
      setError(t("triggerJsonInvalid"));
      setSubmitting(false);
      return;
    }
    try {
      actions = JSON.parse(actionsText);
    } catch {
      setError(t("actionsJsonInvalid"));
      setSubmitting(false);
      return;
    }
    if (!Array.isArray(actions) || actions.length === 0) {
      setError(t("actionsEmpty"));
      setSubmitting(false);
      return;
    }

    try {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        trigger,
        actions,
        active,
      };
      if (isEdit && workflow) {
        await api(`/api/v1/workspaces/${wid}/workflows/${workflow.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/v1/workspaces/${wid}/workflows`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
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
            {isEdit ? t("edit") : t("create")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={t("close")}
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          <div>
            <label className={fieldLabel} htmlFor="wf-name">
              {t("name")}
            </label>
            <input
              id="wf-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className={`${fieldControl} h-10`}
              aria-required="true"
            />
          </div>

          <div>
            <label className={fieldLabel} htmlFor="wf-desc">
              {t("description")}
            </label>
            <input
              id="wf-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              className={fieldControl}
            />
          </div>

          <div>
            <label className={fieldLabel} htmlFor="wf-trigger">
              {t("trigger")}
            </label>
            <textarea
              id="wf-trigger"
              value={triggerText}
              onChange={(e) => setTriggerText(e.target.value)}
              rows={4}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] font-mono"
            />
          </div>

          <div>
            <label className={fieldLabel} htmlFor="wf-actions">
              {t("actions")}
            </label>
            <textarea
              id="wf-actions"
              value={actionsText}
              onChange={(e) => setActionsText(e.target.value)}
              rows={6}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] font-mono"
            />
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 rounded-[var(--radius-sm)] border border-[var(--border)] accent-[var(--accent)]"
            />
            <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">{t("active")}</span>
          </label>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {t("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}