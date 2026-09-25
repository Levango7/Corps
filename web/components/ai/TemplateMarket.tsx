"use client";

/**
 * AI 工作流模板市场 —— 浏览 / 搜索 / 筛选 / 实例化预置模板。
 *
 * 数据流：
 *  GET /api/v1/ai/templates?wid=...&category=...&q=...
 *  POST /api/v1/ai/templates/{id}/instantiate { wid, name? }
 *
 * 交互：
 *  - 顶部搜索框 + 分类筛选标签
 *  - 模板卡片网格（name / description / category / usageCount / steps 数 / 实例化按钮）
 *  - 实例化成功后 Toast + onInstantiated 回调
 *
 * 来源：经验 2026-09-14-multi-database-field-type-layered-implementation-pattern
 *       —— design token + lucide-react size 14/16 + useTranslations。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Search,
  LayoutGrid,
  Users,
  TrendingUp,
  Loader2,
  Sparkles,
  Plus,
  X,
  Check,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/Toast";

/** 模板步骤（与 seed-templates.ts 对齐） */
interface TemplateStep {
  name: string;
  capability: string;
  config: Record<string, unknown>;
}

/** 模板列表项（与 API select 字段对齐） */
interface TemplateItem {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: TemplateStep[];
  isPublic: boolean;
  workspaceId: string | null;
  usageCount: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

/** 分类筛选选项 */
const CATEGORIES = [
  { value: "", labelKey: "all" },
  { value: "project", labelKey: "project" },
  { value: "meeting", labelKey: "meeting" },
  { value: "review", labelKey: "review" },
  { value: "onboarding", labelKey: "onboarding" },
  { value: "custom", labelKey: "custom" },
] as const;

/** 分类 → 图标 + token 颜色映射（无裸 hex，全部走 token） */
function categoryColor(category: string): string {
  switch (category) {
    case "project":
      return "var(--accent)";
    case "meeting":
      return "var(--shell-blue)";
    case "review":
      return "var(--success)";
    case "onboarding":
      return "var(--accent-purple)";
    default:
      return "var(--meta)";
  }
}

const fieldControl =
  "w-full px-2.5 py-2 border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--surface)] text-[length:var(--text-sm)] text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] placeholder:text-[var(--meta)]";

export default function TemplateMarket({
  wid,
  onInstantiated,
}: {
  wid: string;
  onInstantiated?: () => void;
}) {
  const t = useTranslations("ai.aiTemplate");
  const { toast } = useToast();

  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [instantiatingId, setInstantiatingId] = useState<string | null>(null);

  // AbortController：组件卸载 / 新请求时中止进行中的请求
  // 来源：经验 2026-09-12-abortcontroller-timeout-cleartimeout-finally-block
  const abortRef = useRef<AbortController | null>(null);

  const fetchTemplates = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ wid });
      if (category) params.set("category", category);
      if (search.trim()) params.set("q", search.trim());
      const result = await api<{ items: TemplateItem[]; total: number }>(
        `/api/v1/ai/templates?${params.toString()}`,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return;
      setItems(result.items);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      setError(t("loadFailed"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [wid, category, search, t]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function instantiate(template: TemplateItem) {
    if (instantiatingId) return;
    setInstantiatingId(template.id);
    try {
      await api(`/api/v1/ai/templates/${template.id}/instantiate`, {
        method: "POST",
        body: JSON.stringify({ wid, name: template.name }),
      });
      toast("success", t("instantiated"));
      onInstantiated?.();
      // 刷新列表以更新 usageCount
      fetchTemplates();
    } catch (e) {
      console.error("[TemplateMarket] instantiate error:", e);
      toast("error", t("error"));
    } finally {
      setInstantiatingId(null);
    }
  }

  return (
    <div className="space-y-[var(--space-4)]">
      {/* ── 头部：搜索 + 分类筛选 ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <LayoutGrid size={16} className="text-[var(--accent)]" />
          <h2 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
            {t("market")}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--meta)] pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              className={`${fieldControl} pl-8`}
              aria-label={t("search")}
            />
          </div>
        </div>
      </div>

      {/* 分类筛选标签 */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((cat) => {
          const active = category === cat.value;
          return (
            <button
              key={cat.value || "all"}
              type="button"
              onClick={() => setCategory(cat.value)}
              className={`inline-flex items-center h-7 px-3 rounded-[var(--radius-pill)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-[var(--surface-2)] text-[var(--fg-2)] hover:bg-[var(--surface-3)]"
              }`}
            >
              {t(cat.labelKey)}
            </button>
          );
        })}
      </div>

      {/* ── 错误态 ── */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
            aria-label={t("close")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── 加载态 ── */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-[var(--muted)]">
          <Loader2 size={16} className="animate-spin mr-2" />
          <span className="text-[length:var(--text-sm)]">{t("loadFailed")}</span>
        </div>
      )}

      {/* ── 空态 ── */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] gap-2">
          <Sparkles size={24} className="text-[var(--meta)]" />
          <p className="text-[length:var(--text-sm)]">{t("noTemplates")}</p>
        </div>
      )}

      {/* ── 模板卡片网格 ── */}
      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-3)]">
          {items.map((tpl) => {
            const stepCount = Array.isArray(tpl.steps) ? tpl.steps.length : 0;
            const color = categoryColor(tpl.category);
            return (
              <article
                key={tpl.id}
                className="flex flex-col rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] hover:border-[var(--accent)] hover:shadow-[var(--elev-hover)] transition-all duration-[var(--motion-base)]"
              >
                {/* 卡片头部：分类标签 + 可见性 */}
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="inline-flex items-center h-6 px-2 rounded-[var(--radius-pill)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
                      color,
                    }}
                  >
                    {t(tpl.category as "project" | "meeting" | "review" | "onboarding" | "custom")}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                    {tpl.isPublic ? (
                      <>
                        <Users size={14} />
                        <span>{t("public")}</span>
                      </>
                    ) : (
                      <>
                        <X size={14} />
                        <span>{t("private")}</span>
                      </>
                    )}
                  </span>
                </div>

                {/* 名称 + 描述 */}
                <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-1">
                  {tpl.name}
                </h3>
                <p className="flex-1 text-[length:var(--text-sm)] text-[var(--muted)] line-clamp-3 mb-3">
                  {tpl.description}
                </p>

                {/* 步骤预览 */}
                <div className="mb-3 space-y-1">
                  {stepCount > 0 && (
                    <ol className="space-y-0.5">
                      {tpl.steps.slice(0, 3).map((step, idx) => (
                        <li
                          key={`${step.capability}_${idx}`}
                          className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--fg-2)]"
                        >
                          <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--meta)] font-[weight:var(--weight-medium)]">
                            {idx + 1}
                          </span>
                          <span className="truncate">{step.name}</span>
                        </li>
                      ))}
                      {stepCount > 3 && (
                        <li className="text-[length:var(--text-xs)] text-[var(--meta)] pl-5.5">
                          +{stepCount - 3} …
                        </li>
                      )}
                    </ol>
                  )}
                </div>

                {/* 卡片底部：使用次数 + 实例化按钮 */}
                <div className="flex items-center justify-between pt-2 border-t border-[var(--border-soft)]">
                  <span className="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--meta)]">
                    <TrendingUp size={14} />
                    <span>
                      {t("usageCount")}: {tpl.usageCount}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => instantiate(tpl)}
                    disabled={instantiatingId === tpl.id}
                    className="inline-flex items-center gap-1.5 h-8 px-3 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                  >
                    {instantiatingId === tpl.id ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {t("instantiate")}
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        {t("instantiate")}
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 成功提示（实例化后 Toast 已处理，此处保留 Check 图标占位以备扩展） */}
      <span className="sr-only" aria-hidden="true">
        <Check size={14} />
      </span>
    </div>
  );
}
