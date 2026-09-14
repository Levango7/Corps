"use client";

/**
 * 表单构建器。
 *
 * 功能：
 *  - 编辑表单标题/描述/启用状态
 *  - 添加/删除/排序字段（上下移动按钮）
 *  - 每个字段可编辑：label、required、type、options（select/radio/checkbox）
 *  - 保存调用 POST（新建）或 PATCH（编辑）API
 */

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  Trash2,
  Loader2,
  ArrowUp,
  ArrowDown,
  GripVertical,
  AlertCircle,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { FormFieldDefinition, FormFieldType, FormItem } from "./types";
import { FIELD_TYPES, OPTION_FIELD_TYPES } from "./types";

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

/** 生成字段 ID（前端临时 ID，保存时由后端原样存储） */
function genFieldId(): string {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface FormBuilderProps {
  wid: string;
  /** 已有表单（编辑模式）；null 表示新建模式 */
  form: FormItem | null;
  onSaved: (form: FormItem) => void;
  onCancel: () => void;
}

export function FormBuilder({ wid, form, onSaved, onCancel }: FormBuilderProps) {
  const t = useTranslations("form");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormFieldDefinition[]>([]);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (form) {
      setTitle(form.title);
      setDescription(form.description ?? "");
      setFields(form.fields ?? []);
      setActive(form.active);
    } else {
      setTitle("");
      setDescription("");
      setFields([]);
      setActive(true);
    }
    setError("");
  }, [form]);

  function addField() {
    setFields((prev) => [
      ...prev,
      { id: genFieldId(), type: "text", label: "", required: false },
    ]);
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function updateField(id: string, patch: Partial<FormFieldDefinition>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  /** 更新选项列表（逗号分隔或逐个编辑）；这里用换行分隔的 textarea */
  function updateFieldOptions(id: string, optionsText: string) {
    const options = optionsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    updateField(id, { options: options.length > 0 ? options : undefined });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!title.trim()) {
      setError(t("title"));
      return;
    }
    // 校验字段 label 非空
    const validFields = fields.filter((f) => f.label.trim());
    if (validFields.length === 0) {
      setError(t("addField"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        fields: validFields.map((f) => ({
          ...f,
          label: f.label.trim(),
          // 仅选项类型保留 options
          options: OPTION_FIELD_TYPES.includes(f.type) ? f.options : undefined,
        })),
        active,
      };
      if (form) {
        const updated = await api<FormItem>(`/api/v1/workspaces/${wid}/forms/${form.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        onSaved(updated);
      } else {
        const created = await api<FormItem>(`/api/v1/workspaces/${wid}/forms`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        onSaved(created);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* 标题 */}
      <div>
        <label className={fieldLabel} htmlFor="fb-title">
          {t("name")}
        </label>
        <input
          id="fb-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          className={`${fieldControl} h-10`}
        />
      </div>

      {/* 描述 */}
      <div>
        <label className={fieldLabel} htmlFor="fb-desc">
          {t("description")}
        </label>
        <textarea
          id="fb-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={2000}
          className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
        />
      </div>

      {/* 启用状态 */}
      <div className="flex items-center gap-2">
        <label className={fieldLabel}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="w-4 h-4 rounded-[var(--radius-sm)] border border-[var(--border)] accent-[var(--accent)]"
          />
          {t("active")}
        </label>
      </div>

      {/* 字段列表 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={fieldLabel}>{t("fields")}</span>
          <button
            type="button"
            onClick={addField}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
          >
            <Plus size={12} />
            {t("addField")}
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="text-[length:var(--text-xs)] text-[var(--muted)] py-2">{t("noForms")}</p>
        ) : (
          <ul className="space-y-2">
            {fields.map((field, index) => (
              <li
                key={field.id}
                className="p-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)]"
              >
                <div className="flex items-start gap-2">
                  <GripVertical size={14} className="shrink-0 mt-2 text-[var(--muted)]" />
                  <div className="flex-1 space-y-2">
                    {/* label + type */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        value={field.label}
                        onChange={(e) => updateField(field.id, { label: e.target.value })}
                        placeholder={t("fieldLabel")}
                        maxLength={200}
                        className={fieldControl}
                      />
                      <select
                        value={field.type}
                        onChange={(e) =>
                          updateField(field.id, { type: e.target.value as FormFieldType })
                        }
                        className={fieldControl}
                      >
                        {FIELD_TYPES.map((ft) => (
                          <option key={ft} value={ft}>
                            {t(ft)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* options（select/radio/checkbox） */}
                    {OPTION_FIELD_TYPES.includes(field.type) && (
                      <textarea
                        value={(field.options ?? []).join("\n")}
                        onChange={(e) => updateFieldOptions(field.id, e.target.value)}
                        rows={2}
                        placeholder={t("fieldOptions")}
                        className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
                      />
                    )}

                    {/* required */}
                    <label className="inline-flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)]">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(field.id, { required: e.target.checked })}
                        className="w-3.5 h-3.5 rounded-[var(--radius-sm)] border border-[var(--border)] accent-[var(--accent)]"
                      />
                      {t("fieldRequired")}
                    </label>
                  </div>

                  {/* 排序 + 删除按钮 */}
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => moveField(index, -1)}
                      disabled={index === 0}
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface)] disabled:opacity-30 transition-colors duration-[var(--motion-fast)]"
                      aria-label={t("fieldLabel")}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(index, 1)}
                      disabled={index === fields.length - 1}
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface)] disabled:opacity-30 transition-colors duration-[var(--motion-fast)]"
                      aria-label={t("fieldLabel")}
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeField(field.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--danger-fg)] hover:bg-[var(--danger-soft)] transition-colors duration-[var(--motion-fast)]"
                      aria-label={t("removeField")}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label={t("removeField")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors duration-[var(--motion-base)]"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {t("save")}
        </button>
      </div>
    </form>
  );
}