"use client";

/**
 * 表单提交列表组件。
 *
 * 显示提交时间/提交人/数据摘要，支持查看详情。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Inbox, Eye, X, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { FormItem, FormSubmissionItem } from "./types";

interface FormSubmissionListProps {
  wid: string;
  form: FormItem;
  /** 外部递增此 key 以触发刷新 */
  refreshKey: number;
}

export function FormSubmissionList({ wid, form, refreshKey }: FormSubmissionListProps) {
  const t = useTranslations("form");
  const [items, setItems] = useState<FormSubmissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<FormSubmissionItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ items: FormSubmissionItem[]; total: number }>(
          `/api/v1/workspaces/${wid}/forms/${form.id}/submissions`,
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
  }, [wid, form.id, refreshKey, t]);

  /** 将提交数据渲染为字段标签 → 值的摘要 */
  function dataSummary(data: Record<string, unknown>): string {
    const entries = Object.entries(data);
    if (entries.length === 0) return "—";
    return (
      entries
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(", ") + (entries.length > 3 ? "…" : "")
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {t("submissions")}
        </h3>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-[var(--space-8)] text-center text-[var(--muted)]">
          <Loader2 size={18} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-8)] text-center text-[var(--muted)]">
          <Inbox size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-[length:var(--text-sm)]">{t("noForms")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
          {items.map((sub) => (
            <li
              key={sub.id}
              className="px-[var(--space-4)] py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-[length:var(--text-sm)] text-[var(--fg)] truncate">
                  {dataSummary(sub.data)}
                </span>
                <button
                  onClick={() => setDetail(sub)}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                >
                  <Eye size={12} />
                  {t("data")}
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[length:var(--text-xs)] text-[var(--muted)]">
                <span>
                  {t("submittedBy")}: {sub.submitter?.name || sub.submitter?.email || "—"}
                </span>
                <span>·</span>
                <span>
                  {t("submittedAt")}: {new Date(sub.submittedAt).toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 提交详情弹窗 */}
      {detail && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            setDetail(null);
          }}
        >
          <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
            <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
              <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
                {t("data")}
              </h2>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                aria-label={t("close")}
              >
                <X size={16} />
              </button>
            </header>
            <div className="px-5 py-4 space-y-2">
              <div className="text-[length:var(--text-xs)] text-[var(--muted)]">
                {t("submittedAt")}: {new Date(detail.submittedAt).toLocaleString()}
              </div>
              <div className="text-[length:var(--text-xs)] text-[var(--muted)]">
                {t("submittedBy")}: {detail.submitter?.name || detail.submitter?.email || "—"}
              </div>
              <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <pre className="text-[length:var(--text-xs)] text-[var(--fg)] whitespace-pre-wrap break-all font-mono">
                  {JSON.stringify(detail.data, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
