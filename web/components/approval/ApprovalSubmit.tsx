"use client";

/**
 * 发起审批表单（Modal）。
 *
 * 功能：
 * - 选择审批模板（下拉，从 GET /approvals/templates 获取）
 * - 标题（必填）
 * - 描述（可选）
 * - 审批内容（动态键值对输入，可增删行）
 * - 提交（POST /approvals/instances）
 * - Modal 模式：fixed inset-0 + backdrop，ESC 关闭
 *
 * 模板选中后展示其节点配置预览（只读），不参与提交体——
 * 后端会根据 templateId 自动加载节点定义。
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Plus, Trash2, FileText } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 审批模板列表项 */
interface ApprovalTemplate {
  id: string;
  name: string;
  description?: string | null;
  enabled?: boolean;
  nodes?: {
    name: string;
    order: number;
    approverRole?: string | null;
    approverUserId?: string | null;
  }[];
}

interface ApprovalSubmitProps {
  workspaceId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const fieldLabel =
  "flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--meta)] mb-1.5";
const fieldControl =
  "w-full h-9 px-2.5 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]";

export function ApprovalSubmit({
  workspaceId,
  onClose,
  onSubmitted,
}: ApprovalSubmitProps) {
  const t = useTranslations("approval");
  const tButton = useTranslations("button");

  const [templates, setTemplates] = useState<ApprovalTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // 审批内容键值对
  const [contentFields, setContentFields] = useState<
    { key: string; value: string }[]
  >([{ key: "", value: "" }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  const dialogRef = useRef<HTMLDivElement>(null);

  // 拉取模板列表
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<ApprovalTemplate[] | { items: ApprovalTemplate[] }>(
          `/api/v1/workspaces/${workspaceId}/approvals/templates`,
        );
        if (cancelled) return;
        const list = Array.isArray(data) ? data : (data.items ?? []);
        // 仅展示启用的模板
        setTemplates(list.filter((tpl) => tpl.enabled !== false));
      } catch {
        // 模板加载失败不阻塞表单，用户可不选模板直接提交
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // ESC 关闭 + focus trap
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
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
  }, []);

  const selectedTemplate = templates.find((tpl) => tpl.id === templateId);

  function updateContentField(
    idx: number,
    field: "key" | "value",
    val: string,
  ) {
    setContentFields((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item)),
    );
  }

  function addContentField() {
    setContentFields((prev) => [...prev, { key: "", value: "" }]);
  }

  function removeContentField(idx: number) {
    setContentFields((prev) =>
      prev.length > 1
        ? prev.filter((_, i) => i !== idx)
        : [{ key: "", value: "" }],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!title.trim()) {
      setError(t("titleRequired"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // 构造审批内容对象（过滤空键）
      const content: Record<string, string> = {};
      for (const f of contentFields) {
        const key = f.key.trim();
        if (key) content[key] = f.value;
      }
      await api(
        `/api/v1/workspaces/${workspaceId}/approvals/instances`,
        {
          method: "POST",
          body: JSON.stringify({
            templateId: templateId || undefined,
            title: title.trim(),
            description: description.trim() || undefined,
            content: Object.keys(content).length > 0 ? content : undefined,
          }),
        },
      );
      onSubmitted();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : t("submitFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-submit-title"
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center p-4 sm:p-8 overflow-y-auto bg-[var(--overlay)]"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className="w-full max-w-lg my-auto bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2
            id="approval-submit-title"
            className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]"
          >
            {t("submit")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={tButton("close")}
          >
            <X size={16} />
          </button>
        </header>

        <form onSubmit={submit} className="px-4 sm:px-5 py-4 space-y-4">
          {/* 模板选择 */}
          <div>
            <label className={fieldLabel} htmlFor="approval-template">
              {t("selectTemplate")}
            </label>
            <select
              id="approval-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className={fieldControl}
              disabled={loadingTemplates}
            >
              <option value="">{t("noTemplate")}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
            {/* 模板节点预览 */}
            {selectedTemplate?.nodes &&
              selectedTemplate.nodes.length > 0 && (
                <div className="mt-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)]">
                  <p className="text-[length:var(--text-xs)] text-[var(--meta)] mb-1">
                    {t("nodes")}
                  </p>
                  <ol className="space-y-0.5">
                    {[...selectedTemplate.nodes]
                      .sort((a, b) => a.order - b.order)
                      .map((node, i) => (
                        <li
                          key={i}
                          className="text-[length:var(--text-xs)] text-[var(--fg-2)] flex items-center gap-1.5"
                        >
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--meta)]">
                            {node.order}
                          </span>
                          <span className="font-[weight:var(--weight-medium)]">
                            {node.name}
                          </span>
                          {node.approverRole && (
                            <span className="text-[var(--meta)]">
                              · {node.approverRole}
                            </span>
                          )}
                        </li>
                      ))}
                  </ol>
                </div>
              )}
          </div>

          {/* 标题 */}
          <div>
            <label className={fieldLabel} htmlFor="approval-title">
              {t("title")}
            </label>
            <input
              id="approval-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={t("title")}
              className={`${fieldControl} h-10`}
              aria-required="true"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className={fieldLabel} htmlFor="approval-desc">
              {t("description")}
            </label>
            <textarea
              id="approval-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t("description")}
              className="w-full px-2.5 py-2 resize-y border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]"
            />
          </div>

          {/* 审批内容（键值对动态表单） */}
          <div>
            <label className={fieldLabel}>{t("content")}</label>
            <div className="space-y-2">
              {contentFields.map((field, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    value={field.key}
                    onChange={(e) =>
                      updateContentField(idx, "key", e.target.value)
                    }
                    maxLength={100}
                    placeholder={t("contentKeyPlaceholder")}
                    className={`${fieldControl} flex-1`}
                  />
                  <input
                    value={field.value}
                    onChange={(e) =>
                      updateContentField(idx, "value", e.target.value)
                    }
                    maxLength={500}
                    placeholder={t("contentValuePlaceholder")}
                    className={`${fieldControl} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => removeContentField(idx)}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    aria-label={t("delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addContentField}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
              >
                <Plus size={14} />
                {t("addContentField")}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--danger-soft, var(--surface-2))] text-[var(--danger-fg, var(--danger))] text-[length:var(--text-sm)]">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity rounded-[var(--radius-sm)]"
                aria-label={tButton("close")}
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {tButton("cancel")}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FileText size={14} />
              )}
              {submitting ? t("creating") : t("submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ApprovalSubmit;