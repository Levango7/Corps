"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, Loader2, Flag, Calendar, Tag, Milestone as MilestoneIcon } from "lucide-react";
import { api } from "@/lib/api";
import { toLocalDateString, localDateToISOString } from "@/lib/date";
import type { Label, Milestone } from "@/lib/types";

type Status = "todo" | "in_progress" | "review" | "done";
type Priority = "low" | "medium" | "high" | "urgent";

interface Person {
  id: string;
  name: string | null;
  email: string;
}

interface TaskStub {
  id: string;
}

interface TaskStub {
  id: string;
}

const STATUS_OPTS: { value: Status; label: string }[] = [
  { value: "todo", label: "待办" },
  { value: "in_progress", label: "进行中" },
  { value: "review", label: "评审" },
  { value: "done", label: "已完成" },
];

const PRIORITY_OPTS: { value: Priority; label: string; color: string }[] = [
  { value: "low", label: "低", color: "var(--meta)" },
  { value: "medium", label: "中", color: "var(--muted)" },
  { value: "high", label: "高", color: "var(--warn)" },
  { value: "urgent", label: "紧急", color: "var(--danger)" },
];

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export default function NewTaskDialog({
  wid,
  open,
  onClose,
  onCreated,
}: {
  wid: string;
  open: boolean;
  onClose: () => void;
  onCreated?: (t: TaskStub) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [members, setMembers] = useState<Person[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [milestoneId, setMilestoneId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    // 重置 + 拉取成员/标签/里程碑列表
    setTitle("");
    setDescription("");
    setStatus("todo");
    setPriority("medium");
    setAssigneeId("");
    setDueDate("");
    setSelectedLabelIds(new Set());
    setMilestoneId("");
    setError("");
    Promise.all([
      api<Person[]>(`/api/v1/workspaces/${wid}/members`).catch(() => [] as Person[]),
      api<Label[]>(`/api/v1/workspaces/${wid}/labels`).catch(() => [] as Label[]),
      api<Milestone[]>(`/api/v1/workspaces/${wid}/milestones`).catch(() => [] as Milestone[]),
    ]).then(([m, l, ms]) => {
      setMembers(m);
      setLabels(l);
      setMilestones(ms);
    });
  }, [open, wid]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ── focus trap：Tab 在弹窗内循环 ──
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // ── 描述 textarea 自动高度 ──
  useEffect(() => {
    const el = descRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [description, open]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await api<TaskStub>(`/api/v1/workspaces/${wid}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          priority,
          assigneeId: assigneeId || undefined,
          dueDate: dueDate ? localDateToISOString(dueDate) : undefined,
          milestoneId: milestoneId || null,
          labelIds: Array.from(selectedLabelIds),
        }),
      });
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-task-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
      style={{ background: "var(--overlay)" }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="new-task-title"
            className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]"
          >
            新建任务
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          <div>
            <label className={fieldLabel} htmlFor="nt-title">
              标题
            </label>
            <input
              id="nt-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="一句话说清要做什么"
              className={`${fieldControl} h-10`}
              aria-required="true"
            />
          </div>

          <div>
            <label className={fieldLabel} htmlFor="nt-desc">
              描述（可选）
            </label>
            <textarea
              ref={descRef}
              id="nt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="背景、验收标准，或粘贴相关链接…"
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
                className={fieldControl}
              >
                {STATUS_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabel}>
                <Flag size={13} />
                优先级
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={fieldControl}
              >
                {PRIORITY_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>负责人（可选）</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={fieldControl}
              >
                <option value="">未指派</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabel}>
                <Calendar size={13} />
                截止日期（可选）
              </label>
              <input
                type="date"
                min={toLocalDateString(new Date())}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={fieldControl}
              />
            </div>
          </div>

          {/* 里程碑选择（P4：看板标签/里程碑） */}
          {milestones.length > 0 && (
            <div>
              <label className={fieldLabel}>
                <MilestoneIcon size={13} />
                里程碑（可选）
              </label>
              <select
                value={milestoneId}
                onChange={(e) => setMilestoneId(e.target.value)}
                className={fieldControl}
              >
                <option value="">未归入里程碑</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.dueDate ? `（${new Date(m.dueDate).toLocaleDateString()}）` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 标签选择（P4：看板标签/里程碑） */}
          {labels.length > 0 && (
            <div>
              <label className={fieldLabel}>
                <Tag size={13} />
                标签（可选，多选）
              </label>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => {
                  const selected = selectedLabelIds.has(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => {
                        setSelectedLabelIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(label.id)) next.delete(label.id);
                          else next.add(label.id);
                          return next;
                        });
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[length:var(--text-xs)] font-[var(--weight-medium)] transition-all"
                      style={{
                        background: selected
                          ? `color-mix(in srgb, ${label.color} 18%, transparent)`
                          : "var(--surface-2)",
                        color: selected ? label.color : "var(--muted)",
                        border: selected
                          ? `1px solid color-mix(in srgb, ${label.color} 40%, transparent)`
                          : "1px solid var(--border)",
                      }}
                      aria-pressed={selected}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: label.color }}
                        aria-hidden="true"
                      />
                      {label.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
