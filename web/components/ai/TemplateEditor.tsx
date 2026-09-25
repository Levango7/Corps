"use client";

/**
 * AI 工作流模板编辑器 —— 创建 / 编辑模板表单。
 *
 * 数据流：
 *  POST /api/v1/ai/templates          （创建）
 *  PATCH /api/v1/ai/templates/{id}    （更新）
 *
 * 表单字段：name / description / category / steps[] / isPublic
 * 步骤：每步含 name / capability / config（JSON 文本编辑）
 *
 * 来源：经验 2026-09-14-multi-database-field-type-layered-implementation-pattern
 *       —— design token + lucide-react size 14/16 + useTranslations。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Plus, Trash2, Save, GripVertical, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

/** 模板步骤（与 seed-templates.ts 对齐） */
interface TemplateStep {
  name: string;
  capability: string;
  config: Record<string, unknown>;
}

/** 已存在模板（编辑模式预填） */
interface TemplateItem {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: TemplateStep[];
  isPublic: boolean;
}

/** 分类选项 */
const CATEGORY_OPTIONS = [
  { value: "project", labelKey: "project" },
  { value: "meeting", labelKey: "meeting" },
  { value: "review", labelKey: "review" },
  { value: "onboarding", labelKey: "onboarding" },
  { value: "custom", labelKey: "custom" },
] as const;

/** 常用能力选项（供下拉选择） */
const CAPABILITY_OPTIONS = [
  "task-breakdown",
  "project-insight",
  "daily-report",
  "meeting-flow",
  "knowledge-qa",
  "approval-advice",
  "announcement-draft",
  "workflow-build",
  "summarize",
  "translate",
  "format",
] as const;

const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

/** 安全解析 JSON 文本为对象，失败返回 null */
function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v != null && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export default function TemplateEditor({
  wid,
  template,
  onSaved,
  onClose,
}: {
  wid?: string;
  template?: TemplateItem | null;
  onSaved?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("ai.aiTemplate");
  const tButton = useTranslations("button");
  const { toast } = useToast();

  const isEdit = !!template;

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [category, setCategory] = useState(template?.category ?? "project");
  const [isPublic, setIsPublic] = useState(template?.isPublic ?? false);
  const [steps, setSteps] = useState<TemplateStep[]>(
    template?.steps?.length
      ? template.steps.map((s) => ({
          name: s.name,
          capability: s.capability,
          config: s.config ?? {},
        }))
      : [{ name: "", capability: "task-breakdown", config: {} }],
  );
  // 每步的 config JSON 文本（编辑用，提交时解析）
  const [configTexts, setConfigTexts] = useState<string[]>(
    template?.steps?.length
      ? template.steps.map((s) => JSON.stringify(s.config ?? {}, null, 2))
      : ["{}"],
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Escape 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  function updateStep(idx: number, patch: Partial<TemplateStep>) {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function updateConfigText(idx: number, text: string) {
    setConfigTexts((prev) => prev.map((c, i) => (i === idx ? text : c)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { name: "", capability: "task-breakdown", config: {} }]);
    setConfigTexts((prev) => [...prev, "{}"]);
  }

  function removeStep(idx: number) {
    if (steps.length <= 1) return;
    setSteps((prev) => prev.filter((_, i) => i !== idx));
    setConfigTexts((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (submitting) return;
    setError("");

    // 校验 config JSON 文本
    const parsedConfigs: Record<string, unknown>[] = [];
    for (let i = 0; i < configTexts.length; i++) {
      const parsed = tryParseJson(configTexts[i]);
      if (parsed === null) {
        setError(t("error"));
        console.error(`[TemplateEditor] step ${i + 1} config JSON 无效:`, configTexts[i]);
        return;
      }
      parsedConfigs.push(parsed);
    }

    // 组装 steps
    const payloadSteps = steps.map((s, i) => ({
      name: s.name.trim(),
      capability: s.capability,
      config: parsedConfigs[i],
    }));

    // 前端基础校验
    if (!name.trim() || !description.trim()) {
      setError(t("error"));
      return;
    }
    if (payloadSteps.some((s) => !s.name || !s.capability)) {
      setError(t("error"));
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSubmitting(true);
    try {
      const body = {
        ...(wid ? { wid } : {}),
        name: name.trim(),
        description: description.trim(),
        category,
        steps: payloadSteps,
        isPublic: wid ? isPublic : true,
      };
      if (isEdit && template) {
        await api(`/api/v1/ai/templates/${template.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        toast("success", t("templateUpdated"));
      } else {
        await api("/api/v1/ai/templates", {
          method: "POST",
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        toast("success", t("templateCreated"));
      }
      onSaved?.();
      onClose();
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      console.error("[TemplateEditor] submit error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-template-editor-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!submitting) onClose();
      }}
    >
      <div className="w-full max-w-2xl my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        {/* ── 头部 ── */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="ai-template-editor-title"
            className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            {isEdit ? (
              <Pencil size={16} className="text-[var(--accent)]" />
            ) : (
              <Plus size={16} className="text-[var(--accent)]" />
            )}
            {isEdit ? t("edit") : t("create")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        {/* ── 正文 ── */}
        <div className="px-5 py-4 space-y-[var(--space-3)] max-h-[70vh] overflow-y-auto">
          {/* 名称 */}
          <div>
            <label
              className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
              htmlFor="tpl-name"
            >
              {t("name")}
            </label>
            <input
              id="tpl-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              disabled={submitting}
              className={fieldControl}
            />
          </div>

          {/* 描述 */}
          <div>
            <label
              className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
              htmlFor="tpl-desc"
            >
              {t("description")}
            </label>
            <textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              disabled={submitting}
              className={`${fieldControl} resize-y`}
            />
          </div>

          {/* 分类 + 可见性 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-3)]">
            <div>
              <label
                className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
                htmlFor="tpl-category"
              >
                {t("category")}
              </label>
              <select
                id="tpl-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={submitting}
                className={fieldControl}
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            {wid && (
              <div>
                <label
                  className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] mb-1.5"
                  htmlFor="tpl-public"
                >
                  {t("public")}
                </label>
                <button
                  id="tpl-public"
                  type="button"
                  role="switch"
                  aria-checked={isPublic}
                  onClick={() => setIsPublic((v) => !v)}
                  disabled={submitting}
                  className={`relative inline-flex h-6 w-11 items-center rounded-[var(--radius-pill)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
                    isPublic ? "bg-[var(--accent)]" : "bg-[var(--surface-3)]"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-[var(--surface)] shadow-[var(--elev-sm)] transition-transform duration-[var(--motion-fast)] ${
                      isPublic ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            )}
          </div>

          {/* 步骤列表 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
                {t("steps")}
              </label>
              <button
                type="button"
                onClick={addStep}
                disabled={submitting || steps.length >= 50}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-md)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                <Plus size={14} />
                {tButton("add")}
              </button>
            </div>

            <ol className="space-y-2">
              {steps.map((step, idx) => (
                <li
                  key={idx}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <GripVertical size={14} className="text-[var(--meta)] shrink-0" />
                    <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)]">
                      {idx + 1}.
                    </span>
                    <input
                      type="text"
                      value={step.name}
                      onChange={(e) => updateStep(idx, { name: e.target.value })}
                      placeholder={t("name")}
                      maxLength={100}
                      disabled={submitting}
                      className={`${fieldControl} flex-1`}
                      aria-label={`${t("steps")} ${idx + 1} ${t("name")}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeStep(idx)}
                      disabled={submitting || steps.length <= 1}
                      className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger-fg)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                      aria-label={tButton("delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-6">
                    <div>
                      <label
                        className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1"
                        htmlFor={`tpl-cap-${idx}`}
                      >
                        capability
                      </label>
                      <select
                        id={`tpl-cap-${idx}`}
                        value={step.capability}
                        onChange={(e) => updateStep(idx, { capability: e.target.value })}
                        disabled={submitting}
                        className={`${fieldControl} h-8 py-1`}
                      >
                        {CAPABILITY_OPTIONS.map((cap) => (
                          <option key={cap} value={cap}>
                            {cap}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        className="block text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--muted)] mb-1"
                        htmlFor={`tpl-cfg-${idx}`}
                      >
                        config (JSON)
                      </label>
                      <input
                        id={`tpl-cfg-${idx}`}
                        type="text"
                        value={configTexts[idx]}
                        onChange={(e) => updateConfigText(idx, e.target.value)}
                        disabled={submitting}
                        className={`${fieldControl} h-8 py-1 font-mono text-[length:var(--text-xs)]`}
                        aria-label={`${t("steps")} ${idx + 1} config`}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* 错误态 */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] rounded-[var(--radius-sm)]"
                aria-label={tButton("close")}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>

        {/* ── 底部操作栏 ── */}
        <footer className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-[var(--border-soft)]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50"
          >
            {tButton("cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {tButton("save")}
              </>
            ) : (
              <>
                <Save size={14} />
                {tButton("save")}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
