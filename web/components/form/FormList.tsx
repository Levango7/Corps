"use client";

/**
 * 表单列表组件（表单管理主入口）。
 *
 * 显示表单列表（标题/描述/状态/提交数），
 * 支持新建/编辑/删除/预览。
 * 编辑与预览通过弹窗承载 FormBuilder / FormPreview / FormSubmissionList。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Eye,
  ListChecks,
  AlertCircle,
  X,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { api } from "@/lib/api";
import type { FormItem } from "./types";
import { FormBuilder } from "./FormBuilder";
import { FormPreview } from "./FormPreview";
import { FormSubmissionList } from "./FormSubmissionList";

interface FormListProps {
  wid: string;
}

type ModalState =
  | { kind: "none" }
  | { kind: "builder"; form: FormItem | null }
  | { kind: "preview"; form: FormItem }
  | { kind: "submissions"; form: FormItem };

export function FormList({ wid }: FormListProps) {
  const t = useTranslations("form");
  const [items, setItems] = useState<FormItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [refreshSubmissions, setRefreshSubmissions] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: FormItem[]; total: number }>(
          `/api/v1/workspaces/${wid}/forms`,
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
  }, [wid, t]);

  async function handleDelete(form: FormItem) {
    if (deletingId) return;
    if (!window.confirm(t("confirmDelete"))) return;
    setDeletingId(form.id);
    setError("");
    try {
      await api(`/api/v1/workspaces/${wid}/forms/${form.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((f) => f.id !== form.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  function handleSaved(saved: FormItem) {
    setItems((prev) => {
      const idx = prev.findIndex((f) => f.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    setModal({ kind: "none" });
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("title")}
        </h1>
        <button
          onClick={() => setModal({ kind: "builder", form: null })}
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
          <FileText size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("noForms")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((form) => (
            <li
              key={form.id}
              className="px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              <div className="flex items-center gap-2">
                <FileText size={15} className="shrink-0 text-[var(--muted)]" />
                <span className="flex-1 min-w-0 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
                  {form.title}
                </span>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 text-[length:var(--text-xs)] ${form.active ? "text-[var(--success)]" : "text-[var(--muted)]"}`}
                >
                  {form.active ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                  {form.active ? t("active") : t("inactive")}
                </span>
              </div>
              {form.description && (
                <p className="mt-1 ml-6 text-[length:var(--text-xs)] text-[var(--meta)] truncate">
                  {form.description}
                </p>
              )}
              <div className="mt-1 ml-6 flex items-center gap-3 text-[length:var(--text-xs)] text-[var(--muted)]">
                <span>
                  {t("submissions")}: {form._count?.submissions ?? 0}
                </span>
                <span>·</span>
                <span>{new Date(form.updatedAt).toLocaleString()}</span>
              </div>
              <div className="mt-2 ml-6 flex items-center gap-1">
                <button
                  onClick={() => setModal({ kind: "builder", form })}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <Pencil size={12} />
                  {t("edit")}
                </button>
                <button
                  onClick={() => setModal({ kind: "preview", form })}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <Eye size={12} />
                  {t("preview")}
                </button>
                <button
                  onClick={() => setModal({ kind: "submissions", form })}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <ListChecks size={12} />
                  {t("submissions")}
                </button>
                <button
                  onClick={() => handleDelete(form)}
                  disabled={deletingId === form.id}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                >
                  {deletingId === form.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                  {t("delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── 构建器弹窗 ── */}
      {modal.kind === "builder" && (
        <ModalShell
          title={modal.form ? t("edit") : t("create")}
          onClose={() => setModal({ kind: "none" })}
        >
          <FormBuilder
            wid={wid}
            form={modal.form}
            onSaved={handleSaved}
            onCancel={() => setModal({ kind: "none" })}
          />
        </ModalShell>
      )}

      {/* ── 预览弹窗 ── */}
      {modal.kind === "preview" && (
        <ModalShell title={t("preview")} onClose={() => setModal({ kind: "none" })}>
          <FormPreview
            wid={wid}
            form={modal.form}
            onSubmitSuccess={() => setRefreshSubmissions((k) => k + 1)}
          />
        </ModalShell>
      )}

      {/* ── 提交列表弹窗 ── */}
      {modal.kind === "submissions" && (
        <ModalShell title={t("submissions")} onClose={() => setModal({ kind: "none" })}>
          <FormSubmissionList wid={wid} form={modal.form} refreshKey={refreshSubmissions} />
        </ModalShell>
      )}
    </div>
  );
}

/** 弹窗外壳（标题 + 关闭按钮 + 内容区） */
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            aria-label="close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
