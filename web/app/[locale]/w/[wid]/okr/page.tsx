"use client";

/**
 * OKR 管理页面 · /w/[wid]/okr
 *
 * 布局：左侧目标列表（含过滤/新建）+ 右侧目标详情侧栏。
 * 新建目标弹窗内联实现（标题/描述/周期/状态）。
 */

import { use, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { OKRList } from "@/components/okr/OKRList";
import { ObjectiveDetailPanel } from "@/components/okr/ObjectiveDetail";

export default function OkrPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("okr");
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [listKey, setListKey] = useState(0);

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)] mb-[var(--space-5)]">
        {t("title")}
      </h1>

      <div className="flex gap-[var(--space-5)]">
        {/* 左侧列表 */}
        <div className={`flex-1 min-w-0 ${selectedOid ? "hidden lg:block" : ""}`}>
          <OKRList
            key={listKey}
            wid={wid}
            onSelect={setSelectedOid}
            selectedId={selectedOid}
            onCreate={() => setCreateOpen(true)}
          />
        </div>

        {/* 右侧详情侧栏 */}
        {selectedOid && (
          <div className="w-full lg:w-[480px] xl:w-[560px] shrink-0">
            <ObjectiveDetailPanel
              wid={wid}
              oid={selectedOid}
              onClose={() => setSelectedOid(null)}
              onChanged={() => setListKey((k) => k + 1)}
            />
          </div>
        )}
      </div>

      {createOpen && (
        <NewObjectiveDialog
          wid={wid}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setListKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/** 新建目标弹窗（内联） */
function NewObjectiveDialog({
  wid,
  onClose,
  onCreated,
}: {
  wid: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("okr");
  const tButton = useTranslations("button");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState<"draft" | "active" | "completed" | "archived">("draft");
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
      await api(`/api/v1/workspaces/${wid}/objectives`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          period: period.trim(),
          status,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("create"));
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
            {t("create")}
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
            <label className={fieldLabel} htmlFor="obj-title">
              {t("title_")}
            </label>
            <input
              id="obj-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className={`${fieldControl} h-10`}
            />
          </div>

          <div>
            <label className={fieldLabel} htmlFor="obj-desc">
              {t("description")}
            </label>
            <textarea
              id="obj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="obj-period">
                {t("period")}
              </label>
              <input
                id="obj-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2026-Q1"
                maxLength={20}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="obj-status">
                {t("status")}
              </label>
              <select
                id="obj-status"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "draft" | "active" | "completed" | "archived")
                }
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
              {t("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}