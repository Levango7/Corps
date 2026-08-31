"use client";

/**
 * 批量操作工具栏 —— P2 任务批量操作。
 *
 * 在看板/列表多选模式下从底部浮出，提供：
 *  - 批量改状态（todo/in_progress/review/done）
 *  - 批量改优先级（low/medium/high/urgent）
 *  - 批量删除（带确认）
 *  - 取消选择
 *
 * 设计：
 *  - 浮动在视口底部，max-w 限制宽度，居中
 *  - 所有色值走 var(--token)，图标仅用 lucide-react
 *  - 响应式：< sm 紧凑图标按钮，≥ sm 显示文案
 */

import { useState } from "react";
import { X, Trash2, Loader2, CircleDot, Flag, ChevronDown } from "lucide-react";
import type { Status, Priority } from "@/lib/types";
import {
  STATUS_LABEL_KEYS,
  PRIORITY_LABEL_KEYS,
  STATUS_META,
  PRIORITY_COLORS,
} from "@/lib/task-meta";
import { useTranslations } from "next-intl";

interface BatchToolbarProps {
  /** 已选任务 ID 列表 */
  selectedIds: string[];
  /** 取消选择 */
  onClear: () => void;
  /** 批量更新（返回成功数） */
  onUpdate: (patch: {
    status?: Status;
    priority?: Priority;
  }) => Promise<{ updated: number; skipped: number }>;
  /** 批量删除（返回成功数） */
  onDelete: () => Promise<{ deleted: number; skipped: number }>;
  /** 是否可以批量指派（admin/owner）— 当前版本不暴露指派 UI，预留 */
  canAssign?: boolean;
}

export function BatchToolbar({ selectedIds, onClear, onUpdate, onDelete }: BatchToolbarProps) {
  const t = useTranslations("task");
  const tStatus = useTranslations("status");
  const tPriority = useTranslations("priority");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);

  if (selectedIds.length === 0) return null;

  async function handleStatus(status: Status) {
    setStatusOpen(false);
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onUpdate({ status });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("batchUpdateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handlePriority(priority: Priority) {
    setPriorityOpen(false);
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onUpdate({ priority });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("batchUpdateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    if (!window.confirm(t("batchDeleteConfirm", { count: selectedIds.length }))) return;
    setBusy(true);
    setError("");
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("batchDeleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="toolbar"
      aria-label={t("batchToolbarAria")}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[var(--z-sticky)] flex items-center gap-2 px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-lg)]"
    >
      {/* 选中计数 */}
      <span className="text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg)] tabular-nums px-1">
        {selectedIds.length}
      </span>

      {/* 分隔符 */}
      <span className="w-px h-5 bg-[var(--border)]" aria-hidden />

      {/* 状态下拉 */}
      <div className="relative">
        <button
          onClick={() => {
            setStatusOpen((v) => !v);
            setPriorityOpen(false);
          }}
          disabled={busy}
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors"
          aria-label={t("batchStatusAria")}
          aria-expanded={statusOpen}
        >
          <CircleDot size={14} />
          <span className="hidden sm:inline">{t("status")}</span>
          <ChevronDown size={12} className="text-[var(--meta)]" />
        </button>
        {statusOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-36 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--elev-lg)] py-1 z-[var(--z-dropdown)]"
          >
            {(Object.keys(STATUS_LABEL_KEYS) as Status[]).map((s) => {
              const meta = STATUS_META[s];
              const Icon = meta.icon;
              return (
                <button
                  key={s}
                  role="menuitem"
                  onClick={() => handleStatus(s)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  <Icon size={14} style={{ color: meta.color }} />
                  {tStatus(STATUS_LABEL_KEYS[s])}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 优先级下拉 */}
      <div className="relative">
        <button
          onClick={() => {
            setPriorityOpen((v) => !v);
            setStatusOpen(false);
          }}
          disabled={busy}
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors"
          aria-label={t("batchPriorityAria")}
          aria-expanded={priorityOpen}
        >
          <Flag size={14} />
          <span className="hidden sm:inline">{t("priority")}</span>
          <ChevronDown size={12} className="text-[var(--meta)]" />
        </button>
        {priorityOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-0 mb-2 w-32 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--elev-lg)] py-1 z-[var(--z-dropdown)]"
          >
            {(Object.keys(PRIORITY_LABEL_KEYS) as Priority[]).map((p) => (
              <button
                key={p}
                role="menuitem"
                onClick={() => handlePriority(p)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[length:var(--text-sm)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors"
              >
                <Flag size={14} style={{ color: PRIORITY_COLORS[p] }} />
                {tPriority(PRIORITY_LABEL_KEYS[p])}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 删除 */}
      <button
        onClick={handleDelete}
        disabled={busy}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50 transition-colors"
        aria-label={t("batchDeleteAria")}
      >
        <Trash2 size={14} />
        <span className="hidden sm:inline">{t("delete")}</span>
      </button>

      {/* 分隔符 */}
      <span className="w-px h-5 bg-[var(--border)]" aria-hidden />

      {/* 取消选择 */}
      <button
        onClick={onClear}
        disabled={busy}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] text-[length:var(--text-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-50 transition-colors"
        aria-label={t("clearSelectionAria")}
      >
        <X size={14} />
        <span className="hidden sm:inline">{t("cancel")}</span>
      </button>

      {/* 加载指示器 */}
      {busy && <Loader2 size={14} className="animate-spin text-[var(--accent)]" />}

      {/* 错误提示 */}
      {error && (
        <span className="text-[length:var(--text-xs)] text-[var(--danger)] ml-1">{error}</span>
      )}
    </div>
  );
}
