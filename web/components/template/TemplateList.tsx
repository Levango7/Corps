"use client";

/**
 * TemplateList · 项目模板列表（卡片式）
 *
 * 数据流：useEffect 拉 GET /project-templates 列表；按分类过滤（受控 select）。
 * 卡片展示：名称 / 描述 / 分类 badge / 任务数 / 公开标记 / 更新时间。
 * 操作：编辑（onEdit）、应用（onApply）、删除（onDelete）。
 *
 * 样式全部走 design token（var(--*)），图标用 lucide-react（size 14/16）。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Plus,
  Loader2,
  FileText,
  Pencil,
  Play,
  Trash2,
  Globe,
  Lock,
  FolderOpen,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import EmptyState from "@/components/EmptyState";

/** 模板列表项（与 API GET 响应 data.items 对齐） */
export interface TemplateListItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  templateData: { tasks?: unknown[] };
  isPublic: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; name: string | null; email: string } | null;
  /** 列表 API 展平附加的任务数 */
  taskCount?: number;
}

interface TemplateListProps {
  wid: string;
  /** 点击"新建"按钮 */
  onCreate: () => void;
  /** 点击"编辑"按钮 */
  onEdit: (tpl: TemplateListItem) => void;
  /** 点击"应用"按钮 */
  onApply: (tpl: TemplateListItem) => void;
  /** 点击"删除"按钮 */
  onDelete: (tpl: TemplateListItem) => void;
}

export function TemplateList({ wid, onCreate, onEdit, onApply, onDelete }: TemplateListProps) {
  const t = useTranslations("projectTemplate");
  const [items, setItems] = useState<TemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (category) params.set("category", category);
        const data = await api<{ items: TemplateListItem[] }>(
          `/api/v1/workspaces/${wid}/project-templates?${params.toString()}`,
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
  }, [wid, category, t]);

  // 从列表中提取去重的分类选项
  const categories = Array.from(
    new Set(items.map((i) => i.category).filter((c): c is string => !!c)),
  ).sort();

  async function handleDelete(tpl: TemplateListItem) {
    if (!confirm(t("confirmDelete", { name: tpl.name }))) return;
    try {
      await api(`/api/v1/workspaces/${wid}/project-templates/${tpl.id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((i) => i.id !== tpl.id));
      onDelete(tpl);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("deleteFailed");
      setError(msg);
    }
  }

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-[var(--space-5)]">
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("title")}
        </h1>
        <button
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          <Plus size={14} />
          {t("create")}
        </button>
      </div>

      {/* 分类过滤 */}
      {categories.length > 0 && (
        <div className="flex items-center gap-2 mb-[var(--space-4)]">
          <label className="text-[length:var(--text-sm)] text-[var(--meta)]" htmlFor="tpl-category">
            {t("category")}
          </label>
          <select
            id="tpl-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 px-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <option value="">{t("allCategories")}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <div className="mb-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          type="folder"
          title={t("noTemplates")}
          description={t("noTemplatesHint")}
          action={{ label: t("create"), onClick: onCreate }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)]">
          {items.map((tpl) => {
            const taskCount = tpl.taskCount ?? (Array.isArray(tpl.templateData?.tasks) ? tpl.templateData.tasks.length : 0);
            return (
              <article
                key={tpl.id}
                className="flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] hover:shadow-[var(--elev-md)] transition-shadow duration-[var(--motion-fast)] overflow-hidden"
              >
                {/* 头部：名称 + 公开标记 */}
                <header className="flex items-start gap-2 px-[var(--space-4)] py-3 border-b border-[var(--border-soft)]">
                  <FileText size={16} className="shrink-0 mt-0.5 text-[var(--muted)]" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)] truncate">
                      {tpl.name}
                    </h3>
                    {tpl.category && (
                      <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[length:var(--text-xs)] text-[var(--fg-2)]">
                        <FolderOpen size={11} />
                        {tpl.category}
                      </span>
                    )}
                  </div>
                  <span
                    className="shrink-0 inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]"
                    title={tpl.isPublic ? t("isPublic") : t("isPrivate")}
                  >
                    {tpl.isPublic ? <Globe size={13} /> : <Lock size={13} />}
                  </span>
                </header>

                {/* 描述 */}
                <div className="flex-1 px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--fg-2)]">
                  {tpl.description ? (
                    <p className="line-clamp-2">{tpl.description}</p>
                  ) : (
                    <p className="text-[var(--meta)]">{t("noDescription")}</p>
                  )}
                </div>

                {/* 底部：任务数 + 更新时间 + 操作 */}
                <footer className="flex items-center justify-between gap-2 px-[var(--space-4)] py-2 border-t border-[var(--border-soft)] text-[length:var(--text-xs)] text-[var(--meta)]">
                  <span className="tabular-nums">{t("taskCount", { count: taskCount })}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onApply(tpl)}
                      title={t("apply")}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    >
                      <Play size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(tpl)}
                      title={t("edit")}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(tpl)}
                      title={t("delete")}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}