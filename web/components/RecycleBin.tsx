"use client";

/**
 * 回收站组件（阶段 6 任务 223）
 *
 * 功能：
 *  - 类型筛选标签页：全部 / 任务 / 文档
 *  - 列表表格：名称 | 类型 | 删除时间 | 删除人 | 操作（恢复 | 永久删除）
 *  - 分页
 *  - 恢复按钮（POST /recycle-bin/{id}）
 *  - 永久删除按钮（需确认 — window.confirm）
 *  - 空状态提示
 *
 * 数据流：useEffect 拉 GET /recycle-bin 列表；类型筛选 / 翻页触发重新拉取。
 * 操作后乐观从列表移除并刷新计数。
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Trash2, RotateCcw, FileText, CheckSquare, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";

/** 回收站条目（与 API 响应一致） */
interface RecycleItem {
  id: string;
  type: "task" | "document";
  name: string;
  deletedAt: string;
  deletedBy: string | null;
}

/** 列表响应分页结构 */
interface RecycleListResponse {
  items: RecycleItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

/** 类型筛选值 */
type TypeFilter = "all" | "task" | "document";

const PAGE_SIZE = 20;

export function RecycleBin({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("recycleBin");
  const [items, setItems] = useState<RecycleItem[]>([]);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("type", filter);
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      const data = await api<RecycleListResponse>(
        `/api/v1/workspaces/${workspaceId}/recycle-bin?${params.toString()}`,
      );
      setItems(data.items);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filter, page, t]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 切换筛选时回到第一页
  function changeFilter(next: TypeFilter) {
    if (next === filter) return;
    setFilter(next);
    setPage(1);
  }

  // 临时提示（3 秒后自动消失）
  function showToast(kind: "success" | "error", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleRestore(item: RecycleItem) {
    if (actionLoadingId) return;
    setActionLoadingId(item.id);
    try {
      await api(`/api/v1/workspaces/${workspaceId}/recycle-bin/${item.id}`, {
        method: "POST",
      });
      // 乐观从列表移除
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setTotal((prev) => Math.max(0, prev - 1));
      showToast("success", t("restored"));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("restoreFailed");
      showToast("error", msg);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handlePermanentDelete(item: RecycleItem) {
    if (actionLoadingId) return;
    const confirmed = window.confirm(t("confirmDelete"));
    if (!confirmed) return;
    setActionLoadingId(item.id);
    try {
      await api(`/api/v1/workspaces/${workspaceId}/recycle-bin/${item.id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      setTotal((prev) => Math.max(0, prev - 1));
      showToast("success", t("deleted"));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("deleteFailed");
      showToast("error", msg);
    } finally {
      setActionLoadingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterTabs: { key: TypeFilter; label: string }[] = [
    { key: "all", label: t("all") },
    { key: "task", label: t("tasks") },
    { key: "document", label: t("documents") },
  ];

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-[var(--space-5)]">
        <Trash2 size={20} className="text-[var(--muted)]" />
        <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
          {t("title")}
        </h1>
      </div>

      {/* 类型筛选标签页 */}
      <div className="flex items-center gap-1 mb-[var(--space-4)] border-b border-[var(--border-soft)]">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => changeFilter(tab.key)}
            className={
              "inline-flex items-center gap-1.5 h-9 px-3 text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] transition-colors duration-[var(--motion-fast)] border-b-2 -mb-px " +
              (filter === tab.key
                ? "border-[var(--accent)] text-[var(--fg)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]")
            }
          >
            {tab.key === "task" && <CheckSquare size={14} />}
            {tab.key === "document" && <FileText size={14} />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* toast 提示 */}
      {toast && (
        <div
          className={
            "mb-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] " +
            (toast.kind === "success"
              ? "bg-[var(--success-bg)] text-[var(--success)]"
              : "bg-[var(--danger-bg)] text-[var(--danger)]")
          }
        >
          {toast.text}
        </div>
      )}

      {error && <p className="mb-3 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}

      {/* 列表 / 加载 / 空状态 */}
      {loading ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Loader2 size={20} className="inline animate-spin mr-2" />
          {t("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="py-[var(--space-12)] text-center text-[var(--muted)]">
          <Trash2 size={36} className="mx-auto mb-3 opacity-50" />
          <p>{t("empty")}</p>
        </div>
      ) : (
        <>
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-[length:var(--text-sm)]">
              <thead className="bg-[var(--surface-2)] text-[var(--meta)] text-[length:var(--text-xs)] uppercase tracking-wide">
                <tr>
                  <th className="text-left font-[weight:var(--weight-medium)] px-[var(--space-4)] py-[var(--space-2)]">
                    {t("name")}
                  </th>
                  <th className="text-left font-[weight:var(--weight-medium)] px-[var(--space-4)] py-[var(--space-2)] w-24">
                    {t("typeLabel")}
                  </th>
                  <th className="text-left font-[weight:var(--weight-medium)] px-[var(--space-4)] py-[var(--space-2)] w-44">
                    {t("deletedAt")}
                  </th>
                  <th className="text-left font-[weight:var(--weight-medium)] px-[var(--space-4)] py-[var(--space-2)] w-32">
                    {t("deletedBy")}
                  </th>
                  <th className="text-right font-[weight:var(--weight-medium)] px-[var(--space-4)] py-[var(--space-2)] w-40">
                    {t("actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-soft)]">
                {items.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]">
                    <td className="px-[var(--space-4)] py-3 text-[var(--fg)]">
                      <div className="flex items-center gap-2">
                        {item.type === "task" ? (
                          <CheckSquare size={14} className="shrink-0 text-[var(--muted)]" />
                        ) : (
                          <FileText size={14} className="shrink-0 text-[var(--muted)]" />
                        )}
                        <span className="truncate font-[weight:var(--weight-medium)]">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-[var(--space-4)] py-3 text-[var(--meta)]">
                      {item.type === "task" ? t("tasks") : t("documents")}
                    </td>
                    <td className="px-[var(--space-4)] py-3 text-[var(--meta)]">
                      {new Date(item.deletedAt).toLocaleString()}
                    </td>
                    <td className="px-[var(--space-4)] py-3 text-[var(--meta)]">
                      {item.deletedBy ?? t("unknown")}
                    </td>
                    <td className="px-[var(--space-4)] py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => handleRestore(item)}
                          disabled={actionLoadingId === item.id}
                          aria-label={t("restore")}
                          title={t("restore")}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                        >
                          {actionLoadingId === item.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <RotateCcw size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => handlePermanentDelete(item)}
                          disabled={actionLoadingId === item.id}
                          aria-label={t("permanentDelete")}
                          title={t("permanentDelete")}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--danger)] hover:bg-[var(--danger-bg)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between mt-[var(--space-4)]">
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">
              {t("pagination", { page, total: totalPages, count: total })}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label={t("prevPage")}
                className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPage((p) => (hasMore ? p + 1 : p))}
                disabled={!hasMore}
                aria-label={t("nextPage")}
                className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)]"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}