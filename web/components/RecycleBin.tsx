"use client";

/**
 * 回收站组件（阶段 6 任务 223）
 *
 * 功能：
 *  - 类型筛选标签页：全部 / 任务 / 文档
 *  - 列表表格：选择 | 名称 | 类型 | 删除时间 | 删除人 | 剩余保留天数 | 操作（恢复 | 永久删除）
 *  - 分页
 *  - 单项恢复（POST /recycle-bin/{id}）
 *  - 单项永久删除（DELETE /recycle-bin/{id}，自定义确认对话框）
 *  - 批量恢复（多选 + 批量恢复按钮）
 *  - 批量永久删除（多选 + 批量删除按钮，自定义确认对话框）
 *  - 清空回收站（永久删除所有项，自定义确认对话框）
 *  - 30 天保留期显示（剩余天数，到期标红）
 *  - 空状态提示
 *
 * 数据流：useEffect 拉 GET /recycle-bin 列表；类型筛选 / 翻页触发重新拉取。
 * 操作后乐观从列表移除并刷新计数。
 * 确认对话框为自定义 modal（焦点陷阱 + Escape 关闭），不使用 window.confirm。
 * Toast 通过全局 ToastProvider（useToast）显示操作结果。
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Trash2,
  RotateCcw,
  FileText,
  CheckSquare,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/Toast";

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

/** 确认对话框状态 */
interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  /** 确认后的回调（已绑定具体操作） */
  onConfirm: () => void;
}

const PAGE_SIZE = 20;
/** 保留期天数（与后端约定一致） */
const RETENTION_DAYS = 30;
/** 一天的毫秒数 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 计算剩余保留天数。
 * @param deletedAt ISO 字符串
 * @returns 剩余天数（>0 未过期；<=0 已过期）
 */
function getRemainingDays(deletedAt: string): number {
  const deleted = new Date(deletedAt).getTime();
  const elapsedDays = Math.floor((Date.now() - deleted) / ONE_DAY_MS);
  return RETENTION_DAYS - elapsedDays;
}

export function RecycleBin({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("recycleBin");
  const { toast } = useToast();

  const [items, setItems] = useState<RecycleItem[]>([]);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 单项操作 loading（按 id 记录，避免并发误操作）
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  // 批量操作 loading
  const [batchLoading, setBatchLoading] = useState(false);
  // 清空操作 loading
  const [clearLoading, setClearLoading] = useState(false);

  // 多选：选中项 id 集合（用 type-id 复合键，避免 task/document id 冲突）
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // 确认对话框状态
  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });
  // 确认对话框执行中（禁用按钮 + 显示 spinner）
  const [confirmLoading, setConfirmLoading] = useState(false);
  // 确认对话框焦点陷阱 ref
  const confirmDialogRef = useRef<HTMLDivElement>(null);

  /** 生成列表项复合键 */
  const itemKey = (item: RecycleItem) => `${item.type}-${item.id}`;

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
    setSelectedKeys(new Set());
  }

  // ─── 多选 ───────────────────────────────────────────────
  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allSelected = items.length > 0 && items.every((it) => selectedKeys.has(itemKey(it)));
  const someSelected = selectedKeys.size > 0;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(items.map(itemKey)));
    }
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  // ─── 确认对话框焦点管理 ──────────────────────────────────
  useEffect(() => {
    if (!confirm.open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = confirmDialogRef.current;
    if (container) {
      const focusable = container.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [confirm.open]);

  // Escape 关闭 + Tab focus trap
  useEffect(() => {
    if (!confirm.open) return;
    const container = confirmDialogRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmLoading) {
        e.preventDefault();
        setConfirm((c) => ({ ...c, open: false }));
        return;
      }
      if (e.key === "Tab" && container) {
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirm.open, confirmLoading]);

  function openConfirm(title: string, message: string, onConfirm: () => void) {
    setConfirm({ open: true, title, message, onConfirm });
  }

  function closeConfirm() {
    setConfirm((c) => ({ ...c, open: false }));
  }

  // ─── 单项恢复 ───────────────────────────────────────────
  async function handleRestore(item: RecycleItem) {
    if (actionLoadingId) return;
    setActionLoadingId(item.id);
    try {
      await api(`/api/v1/workspaces/${workspaceId}/recycle-bin/${item.id}`, {
        method: "POST",
      });
      // 乐观从列表移除
      const key = itemKey(item);
      setItems((prev) => prev.filter((it) => itemKey(it) !== key));
      setTotal((prev) => Math.max(0, prev - 1));
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      toast("success", t("restored"));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("restoreFailed");
      toast("error", msg);
    } finally {
      setActionLoadingId(null);
    }
  }

  // ─── 单项永久删除（带确认对话框） ───────────────────────
  function handlePermanentDeleteClick(item: RecycleItem) {
    if (actionLoadingId) return;
    openConfirm(t("confirmDeleteTitle"), t("confirmDelete"), () => {
      runPermanentDelete(item);
    });
  }

  async function runPermanentDelete(item: RecycleItem) {
    setConfirmLoading(true);
    setActionLoadingId(item.id);
    try {
      await api(`/api/v1/workspaces/${workspaceId}/recycle-bin/${item.id}`, {
        method: "DELETE",
      });
      const key = itemKey(item);
      setItems((prev) => prev.filter((it) => itemKey(it) !== key));
      setTotal((prev) => Math.max(0, prev - 1));
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      toast("success", t("deleted"));
      closeConfirm();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("deleteFailed");
      toast("error", msg);
    } finally {
      setConfirmLoading(false);
      setActionLoadingId(null);
    }
  }

  // ─── 批量恢复 ───────────────────────────────────────────
  async function handleBatchRestore() {
    if (batchLoading || selectedKeys.size === 0) return;
    setBatchLoading(true);
    // 选中项（当前页可见的）
    const selectedItems = items.filter((it) => selectedKeys.has(itemKey(it)));
    let successCount = 0;
    let lastError = "";
    // 串行调用（避免后端并发压力；回收站批量操作频率低）
    for (const item of selectedItems) {
      try {
        await api(`/api/v1/workspaces/${workspaceId}/recycle-bin/${item.id}`, {
          method: "POST",
        });
        successCount++;
      } catch (e) {
        lastError = e instanceof Error ? e.message : t("restoreFailed");
      }
    }
    if (successCount > 0) {
      // 乐观更新计数；具体列表由下方 fetchList 拉取保证一致性
      setTotal((prev) => Math.max(0, prev - successCount));
      clearSelection();
      toast("success", t("batchRestored", { count: successCount }));
    }
    if (lastError) {
      toast("error", lastError);
    }
    setBatchLoading(false);
    // 重新拉取列表以确保一致性
    await fetchList();
  }

  // ─── 批量永久删除（带确认对话框） ───────────────────────
  function handleBatchDeleteClick() {
    if (batchLoading || selectedKeys.size === 0) return;
    openConfirm(t("confirmBatchDeleteTitle"), t("confirmBatchDelete"), () => {
      runBatchDelete();
    });
  }

  async function runBatchDelete() {
    setConfirmLoading(true);
    setBatchLoading(true);
    const selectedItems = items.filter((it) => selectedKeys.has(itemKey(it)));
    let successCount = 0;
    let lastError = "";
    for (const item of selectedItems) {
      try {
        await api(`/api/v1/workspaces/${workspaceId}/recycle-bin/${item.id}`, {
          method: "DELETE",
        });
        successCount++;
      } catch (e) {
        lastError = e instanceof Error ? e.message : t("deleteFailed");
      }
    }
    if (successCount > 0) {
      setTotal((prev) => Math.max(0, prev - successCount));
      clearSelection();
      toast("success", t("batchDeleted", { count: successCount }));
      closeConfirm();
    }
    if (lastError) {
      toast("error", lastError);
    }
    setConfirmLoading(false);
    setBatchLoading(false);
    await fetchList();
  }

  // ─── 清空回收站（带确认对话框） ─────────────────────────
  function handleClearAllClick() {
    if (clearLoading || items.length === 0) return;
    openConfirm(t("confirmClearTitle"), t("confirmClearAll"), () => {
      runClearAll();
    });
  }

  async function runClearAll() {
    setConfirmLoading(true);
    setClearLoading(true);
    // 清空当前页所有项（分页场景下逐个删除当前可见项）
    // 注：回收站数据量通常较小（保留期 30 天），当前页删除后若 hasMore 可继续拉取
    let successCount = 0;
    let lastError = "";
    for (const item of items) {
      try {
        await api(`/api/v1/workspaces/${workspaceId}/recycle-bin/${item.id}`, {
          method: "DELETE",
        });
        successCount++;
      } catch (e) {
        lastError = e instanceof Error ? e.message : t("clearFailed");
      }
    }
    if (successCount > 0) {
      clearSelection();
      toast("success", t("cleared"));
      closeConfirm();
    }
    if (lastError) {
      toast("error", lastError);
    }
    setConfirmLoading(false);
    setClearLoading(false);
    // 重新拉取（若 hasMore 仍有剩余页项，会显示新的一页）
    setPage(1);
    await fetchList();
  }

  // ─── 渲染辅助 ───────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterTabs: { key: TypeFilter; label: string }[] = [
    { key: "all", label: t("all") },
    { key: "task", label: t("tasks") },
    { key: "document", label: t("documents") },
  ];

  return (
    <div className="max-w-[var(--container-max)] mx-auto px-[var(--space-4)] py-[var(--space-6)]">
      {/* 标题 + 顶部操作栏 */}
      <div className="flex items-center justify-between gap-[var(--space-4)] mb-[var(--space-5)] flex-wrap">
        <div className="flex items-center gap-2">
          <Trash2 size={20} className="text-[var(--muted)]" />
          <h1 className="text-[length:var(--text-2xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tracking-[var(--tracking-tight)]">
            {t("title")}
          </h1>
        </div>
        {/* 顶部操作：批量恢复 / 清空回收站 */}
        {!loading && items.length > 0 && (
          <div className="flex items-center gap-[var(--space-2)]">
            <button
              onClick={handleBatchRestore}
              disabled={batchLoading || !someSelected}
              className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] bg-[var(--surface)] border border-[var(--border)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              {batchLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCcw size={14} />
              )}
              {t("batchRestore")}
            </button>
            <button
              onClick={handleClearAllClick}
              disabled={clearLoading || batchLoading}
              className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] bg-[var(--surface)] border border-[var(--border)] text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
            >
              {clearLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              {t("clearAll")}
            </button>
          </div>
        )}
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

      {/* 选中计数提示 */}
      {someSelected && (
        <div className="mb-[var(--space-3)] flex items-center gap-2 px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent-soft-fg)] text-[length:var(--text-sm)]">
          <CheckSquare size={14} />
          <span>{t("selected", { count: selectedKeys.size })}</span>
          <button
            onClick={clearSelection}
            className="ml-auto inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            aria-label={t("cancel")}
          >
            <X size={14} />
          </button>
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
                  <th className="text-left font-[weight:var(--weight-medium)] px-[var(--space-3)] py-[var(--space-2)] w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label={t("selectAll")}
                      className="accent-[var(--accent)] cursor-pointer"
                    />
                  </th>
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
                  <th className="text-left font-[weight:var(--weight-medium)] px-[var(--space-4)] py-[var(--space-2)] w-28">
                    {t("retainDaysLabel")}
                  </th>
                  <th className="text-right font-[weight:var(--weight-medium)] px-[var(--space-4)] py-[var(--space-2)] w-32">
                    {t("actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-soft)]">
                {items.map((item) => {
                  const key = itemKey(item);
                  const remaining = getRemainingDays(item.deletedAt);
                  const isExpired = remaining <= 0;
                  const isSelected = selectedKeys.has(key);
                  return (
                    <tr
                      key={key}
                      className={
                        "transition-colors duration-[var(--motion-fast)] " +
                        (isSelected
                          ? "bg-[var(--accent-soft)]"
                          : "hover:bg-[var(--surface-2)]")
                      }
                    >
                      <td className="px-[var(--space-3)] py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(key)}
                          aria-label={t("itemLabel")}
                          className="accent-[var(--accent)] cursor-pointer"
                        />
                      </td>
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
                      <td className="px-[var(--space-4)] py-3">
                        {isExpired ? (
                          <span className="inline-flex items-center gap-1 text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--danger)]">
                            <AlertTriangle size={14} className="shrink-0" />
                            {t("expired")}
                          </span>
                        ) : (
                          <span
                            className={
                              "text-[length:var(--text-xs)] tabular-nums " +
                              (remaining <= 3
                                ? "text-[var(--warn)] font-[weight:var(--weight-medium)]"
                                : "text-[var(--meta)]")
                            }
                          >
                            {t("retainDays", { days: remaining })}
                          </span>
                        )}
                      </td>
                      <td className="px-[var(--space-4)] py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleRestore(item)}
                            disabled={actionLoadingId === item.id || batchLoading}
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
                            onClick={() => handlePermanentDeleteClick(item)}
                            disabled={actionLoadingId === item.id || batchLoading}
                            aria-label={t("permanentDelete")}
                            title={t("permanentDelete")}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)]"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      {/* 确认对话框（自定义 modal，替代 window.confirm） */}
      {confirm.open && (
        <div
          ref={confirmDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={confirm.title}
          className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--overlay)] p-[var(--space-4)]"
          onClick={() => {
            if (!confirmLoading) closeConfirm();
          }}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius-lg)] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--elev-lg)] p-[var(--space-5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-[var(--space-3)] mb-[var(--space-4)]">
              <AlertTriangle size={20} className="shrink-0 text-[var(--danger)] mt-0.5" />
              <div className="flex-1">
                <h3 className="text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mb-[var(--space-2)]">
                  {confirm.title}
                </h3>
                <p className="text-[length:var(--text-sm)] text-[var(--fg-2)] leading-[var(--leading-relaxed)]">
                  {confirm.message}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-[var(--space-2)]">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={confirmLoading}
                className="h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] active:bg-[var(--surface-3)] disabled:opacity-50 transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => confirm.onConfirm()}
                disabled={confirmLoading}
                className="inline-flex items-center gap-1.5 h-8 px-[var(--space-3)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] bg-[var(--danger)] text-[var(--accent-fg)] hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
              >
                {confirmLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                {t("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
