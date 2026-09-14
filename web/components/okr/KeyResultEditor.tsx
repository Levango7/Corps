"use client";

/**
 * 关键结果编辑器（弹窗）。
 * 支持创建（kr=null）和编辑（kr=对象）两种模式。
 * 字段：标题/目标值/当前值/单位/权重/负责人/截止日期。
 */

import { useEffect, useState, type FormEvent } from "react";
import { X, Loader2, Calendar } from "lucide-react";
import { api } from "@/lib/api";
import { toLocalDateString, localDateToISOString } from "@/lib/date";
import { useTranslations } from "next-intl";

export interface KeyResult {
  id: string;
  objectiveId: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  weight: number;
  ownerId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string | null; email: string } | null;
}

interface Person {
  id: string;
  name: string | null;
  email: string;
}

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export default function KeyResultEditor({
  wid,
  oid,
  kr,
  open,
  onClose,
  onSaved,
}: {
  wid: string;
  oid: string;
  kr?: KeyResult | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useTranslations("okr");
  const tButton = useTranslations("button");
  const [title, setTitle] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [currentValue, setCurrentValue] = useState("0");
  const [unit, setUnit] = useState("");
  const [weight, setWeight] = useState("1");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [members, setMembers] = useState<Person[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(kr?.title ?? "");
    setTargetValue(String(kr?.targetValue ?? ""));
    setCurrentValue(String(kr?.currentValue ?? "0"));
    setUnit(kr?.unit ?? "");
    setWeight(String(kr?.weight ?? "1"));
    setOwnerId(kr?.ownerId ?? "");
    setDueDate(kr?.dueDate ? toLocalDateString(new Date(kr.dueDate)) : "");
    setError("");
    api<Person[]>(`/api/v1/workspaces/${wid}/members`)
      .catch(() => [] as Person[])
      .then(setMembers);
  }, [open, wid, kr]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        title: title.trim(),
        targetValue: parseFloat(targetValue) || 0,
        currentValue: parseFloat(currentValue) || 0,
        unit: unit.trim() || undefined,
        weight: parseFloat(weight) || 1,
        ownerId: ownerId || undefined,
        dueDate: dueDate ? localDateToISOString(dueDate) : undefined,
      };
      if (kr) {
        await api(
          `/api/v1/workspaces/${wid}/objectives/${oid}/key-results/${kr.id}`,
          { method: "PATCH", body: JSON.stringify(payload) },
        );
      } else {
        await api(`/api/v1/workspaces/${wid}/objectives/${oid}/key-results`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("edit"));
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
            {kr ? t("edit") : t("addKeyResult")}
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
            <label className={fieldLabel} htmlFor="kr-title">
              {t("title_")}
            </label>
            <input
              id="kr-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className={`${fieldControl} h-10`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="kr-target">
                {t("targetValue")}
              </label>
              <input
                id="kr-target"
                type="number"
                step="any"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="kr-current">
                {t("currentValue")}
              </label>
              <input
                id="kr-current"
                type="number"
                step="any"
                value={currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
                className={fieldControl}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="kr-unit">
                {t("unit")}
              </label>
              <input
                id="kr-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={20}
                className={fieldControl}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="kr-weight">
                {t("weight")}
              </label>
              <input
                id="kr-weight"
                type="number"
                step="any"
                min="0"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className={fieldControl}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="kr-owner">
                {t("owner")}
              </label>
              <select
                id="kr-owner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={fieldControl}
              >
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={fieldLabel} htmlFor="kr-due">
                <Calendar size={13} />
                {t("dueDate")}
              </label>
              <input
                id="kr-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={fieldControl}
              />
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
              disabled={!title.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)]"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {kr ? t("edit") : t("addKeyResult")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}