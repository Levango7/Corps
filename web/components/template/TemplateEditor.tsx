"use client";

/**
 * TemplateEditor · 项目模板编辑器（弹窗）
 *
 * 功能：
 *  - 名称 / 描述 / 分类 / 公开标记 输入
 *  - 任务列表编辑：添加 / 删除 / 上移 / 下移任务项
 *  - 每个任务项有 title（必填）/ description（可选）/ priority（下拉）
 *  - 新建模式（template=null）调 POST；编辑模式（template 非空）调 PATCH
 *
 * 样式全部走 design token，图标 lucide-react（size 14/16）。
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Plus, Trash2, ChevronUp, ChevronDown, Flag } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { TemplateListItem } from "./TemplateList";

type Priority = "low" | "medium" | "high" | "urgent";

interface TaskItem {
  title: string;
  description?: string;
  priority: Priority;
}

interface TemplateEditorProps {
  wid: string;
  /** null=新建模式；非 null=编辑模式（传入初始值） */
  template: TemplateListItem | null;
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调（返回新/更新后的模板） */
  onSaved: () => void;
}

const PRIORITY_OPTS: Priority[] = ["low", "medium", "high", "urgent"];

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export function TemplateEditor({ wid, template, open, onClose, onSaved }: TemplateEditorProps) {
  const t = useTranslations("projectTemplate");
  const tPriority = useTranslations("priority");
  const tButton = useTranslations("button");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setDescription(template.description ?? "");
      setCategory(template.category ?? "");
      setIsPublic(template.isPublic);
      const data = template.templateData as { tasks?: TaskItem[] };
      setTasks(
        Array.isArray(data?.tasks)
          ? data.tasks.map((tk) => ({
              title: tk.title ?? "",
              description: tk.description ?? "",
              priority: (tk.priority as Priority) ?? "medium",
            }))
          : [],
      );
    } else {
      setName("");
      setDescription("");
      setCategory("");
      setIsPublic(false);
      setTasks([{ title: "", description: "", priority: "medium" }]);
    }
    setError("");
  }, [open, template]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function addTask() {
    setTasks((prev) => [...prev, { title: "", description: "", priority: "medium" }]);
  }

  function removeTask(idx: number) {
    setTasks((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveTask(idx: number, dir: -1 | 1) {
    setTasks((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function updateTask(idx: number, patch: Partial<TaskItem>) {
    setTasks((prev) => prev.map((tk, i) => (i === idx ? { ...tk, ...patch } : tk)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    // 过滤掉空标题的任务项
    const validTasks = tasks
      .filter((tk) => tk.title.trim())
      .map((tk) => ({
        title: tk.title.trim(),
        description: tk.description?.trim() || undefined,
        priority: tk.priority,
      }));
    if (validTasks.length === 0) {
      setError(t("needAtLeastOneTask"));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        isPublic,
        templateData: { tasks: validTasks, labels: [], milestones: [] },
      };
      if (template) {
        await api(`/api/v1/workspaces/${wid}/project-templates/${template.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/api/v1/workspaces/${wid}/project-templates`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("saveFailed");
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpl-editor-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-2xl my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="tpl-editor-title"
            className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            {template ? t("edit") : t("create")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          {/* 名称 */}
          <div>
            <label className={fieldLabel} htmlFor="tpl-name">
              {t("name")}
            </label>
            <input
              id="tpl-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              className={`${fieldControl} h-10`}
              aria-required="true"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className={fieldLabel} htmlFor="tpl-desc">
              {t("description")}
            </label>
            <textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          {/* 分类 + 公开 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="tpl-category">
                {t("category")}
              </label>
              <input
                id="tpl-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={100}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel}>{t("isPublic")}</label>
              <button
                type="button"
                onClick={() => setIsPublic((v) => !v)}
                className={`inline-flex items-center gap-2 h-9 px-3 rounded-[var(--radius-md)] border text-[length:var(--text-sm)] transition-colors duration-[var(--motion-fast)] ${
                  isPublic
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-fg)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)]"
                }`}
                aria-pressed={isPublic}
              >
                <span
                  className={`inline-block w-4 h-4 rounded-[var(--radius-sm)] border ${
                    isPublic
                      ? "border-[var(--accent)] bg-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                />
                {isPublic ? t("public") : t("private")}
              </button>
            </div>
          </div>

          {/* 任务列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={fieldLabel}>{t("tasks")}</label>
              <button
                type="button"
                onClick={addTask}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <Plus size={13} />
                {t("addTask")}
              </button>
            </div>
            <ul className="space-y-2">
              {tasks.map((tk, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 p-2.5 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-2)]"
                >
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      value={tk.title}
                      onChange={(e) => updateTask(idx, { title: e.target.value })}
                      maxLength={255}
                      placeholder={t("taskTitle")}
                      className="w-full h-8 px-2 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    />
                    <input
                      value={tk.description ?? ""}
                      onChange={(e) => updateTask(idx, { description: e.target.value })}
                      maxLength={5000}
                      placeholder={t("taskDescription")}
                      className="w-full h-8 px-2 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    />
                    <div className="flex items-center gap-1.5">
                      <Flag size={12} className="text-[var(--meta)]" />
                      <select
                        value={tk.priority}
                        onChange={(e) => updateTask(idx, { priority: e.target.value as Priority })}
                        className="h-7 px-1.5 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      >
                        {PRIORITY_OPTS.map((p) => (
                          <option key={p} value={p}>
                            {tPriority(p)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveTask(idx, -1)}
                      disabled={idx === 0}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface)] hover:text-[var(--fg)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label={t("moveUp")}
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTask(idx, 1)}
                      disabled={idx === tasks.length - 1}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface)] hover:text-[var(--fg)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label={t("moveDown")}
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTask(idx)}
                      className="inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface)] hover:text-[var(--danger)] transition-colors"
                      aria-label={t("removeTask")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {tasks.length === 0 && (
              <p className="mt-2 text-[length:var(--text-xs)] text-[var(--meta)]">{t("noTasks")}</p>
            )}
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

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {template ? t("save") : t("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
