"use client";

/**
 * 表单预览组件。
 *
 * 根据 fields 定义渲染表单输入控件。
 * - readOnly 模式：仅展示，不提交（用于预览面板）
 * - 可提交模式：渲染提交按钮，调用 onSubmit 回调
 */

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import type { FormFieldDefinition, FormItem } from "./types";

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

interface FormPreviewProps {
  wid: string;
  form: FormItem;
  /** 只读模式（仅展示，不渲染提交按钮） */
  readOnly?: boolean;
  /** 提交成功回调 */
  onSubmitSuccess?: () => void;
}

export function FormPreview({ wid, form, readOnly, onSubmitSuccess }: FormPreviewProps) {
  const t = useTranslations("form");
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  function updateValue(fieldId: string, value: string) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || readOnly) return;
    setSubmitting(true);
    setError("");
    setSuccess(false);
    try {
      await api(`/api/v1/workspaces/${wid}/forms/${form.id}/submissions`, {
        method: "POST",
        body: JSON.stringify({ data: values }),
      });
      setSuccess(true);
      setValues({});
      onSubmitSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 表单标题与描述 */}
      <div>
        <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {form.title}
        </h3>
        {form.description && (
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--meta)]">{form.description}</p>
        )}
      </div>

      {/* 字段渲染 */}
      {form.fields.map((field) => (
        <FieldRenderer
          key={field.id}
          field={field}
          value={values[field.id] ?? ""}
          onChange={(v) => updateValue(field.id, v)}
          readOnly={readOnly}
          labelClass={fieldLabel}
          controlClass={fieldControl}
          t={t}
        />
      ))}

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label={t("close")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {success && (
        <div className="px-3 py-2 rounded-[var(--radius-md)] bg-[var(--success-soft)] text-[var(--success-fg)] text-[length:var(--text-sm)]">
          {t("submitSuccess")}
        </div>
      )}

      {/* 提交按钮 */}
      {!readOnly && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-base)]"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {t("submit")}
          </button>
        </div>
      )}
    </form>
  );
}

/** 单个字段渲染器 */
function FieldRenderer({
  field,
  value,
  onChange,
  readOnly,
  labelClass,
  controlClass,
  t,
}: {
  field: FormFieldDefinition;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  labelClass: string;
  controlClass: string;
  t: (key: string) => string;
}) {
  const id = `fp-${field.id}`;
  const labelNode = (
    <label className={labelClass} htmlFor={id}>
      {field.label}
      {field.required && <span className="text-[var(--danger-fg)]">*</span>}
    </label>
  );

  const commonProps = {
    id,
    value,
    disabled: readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(e.target.value),
  };

  switch (field.type) {
    case "textarea":
      return (
        <div>
          {labelNode}
          <textarea
            {...commonProps}
            rows={3}
            className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] disabled:opacity-60"
          />
        </div>
      );
    case "number":
      return (
        <div>
          {labelNode}
          <input
            type="number"
            {...commonProps}
            className={`${controlClass} disabled:opacity-60`}
          />
        </div>
      );
    case "date":
      return (
        <div>
          {labelNode}
          <input
            type="date"
            {...commonProps}
            className={`${controlClass} disabled:opacity-60`}
          />
        </div>
      );
    case "select":
      return (
        <div>
          {labelNode}
          <select {...commonProps} className={`${controlClass} disabled:opacity-60`}>
            <option value="">—</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    case "radio":
      return (
        <div>
          {labelNode}
          <div className="flex flex-col gap-1.5">
            {(field.options ?? []).map((opt) => (
              <label key={opt} className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--fg)]">
                <input
                  type="radio"
                  name={id}
                  value={opt}
                  checked={value === opt}
                  disabled={readOnly}
                  onChange={() => onChange(opt)}
                  className="w-4 h-4 accent-[var(--accent)]"
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
      );
    case "checkbox":
      return (
        <div>
          {labelNode}
          <div className="flex flex-col gap-1.5">
            {(field.options ?? []).map((opt) => (
              <label key={opt} className="inline-flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--fg)]">
                <input
                  type="checkbox"
                  checked={value === opt}
                  disabled={readOnly}
                  onChange={(e) => onChange(e.target.checked ? opt : "")}
                  className="w-4 h-4 rounded-[var(--radius-sm)] accent-[var(--accent)]"
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
      );
    case "text":
    default:
      return (
        <div>
          {labelNode}
          <input type="text" {...commonProps} className={`${controlClass} disabled:opacity-60`} />
        </div>
      );
  }
}