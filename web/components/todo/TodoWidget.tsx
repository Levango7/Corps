"use client";

/**
 * 待办小组件（可嵌入仪表盘）。
 *
 * 紧凑布局：
 *  - 显示今日待办数（pending 总数）
 *  - 最近 5 条待办（类型图标 + 标题 + 截止日期）
 *  - 点击"查看全部"跳转到待办中心
 *
 * Design token 样式 + lucide-react 图标 size 14/16。
 * Props: { workspaceId, onViewAll? }
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CheckSquare,
  ClipboardCheck,
  Video,
  FileText,
  Loader2,
  AlertCircle,
  ArrowRight,
  Inbox,
} from "lucide-react";
import { api } from "@/lib/api";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

type TodoType = "task" | "approval" | "meeting" | "document";

interface TodoItem {
  id: string;
  type: TodoType;
  title: string;
  description?: string;
  dueDate?: string;
  priority?: string;
  sourceUrl: string;
  status: string;
  createdAt: string;
}

interface TodoCountResult {
  total: number;
  byType: {
    task: number;
    approval: number;
    meeting: number;
    document: number;
  };
}

// ─── 常量映射 ──────────────────────────────────────────────────────────────────

/** 类型 → 图标映射 */
const TYPE_ICON: Record<TodoType, typeof CheckSquare> = {
  task: CheckSquare,
  approval: ClipboardCheck,
  meeting: Video,
  document: FileText,
};

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 格式化截止日期（简短相对时间，已过期标红） */
function formatDueDate(
  iso: string,
  t: ReturnType<typeof useTranslations>,
): { text: string; overdue: boolean } {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const overdue = diffMs < 0;

  const absDiffMs = Math.abs(diffMs);
  const diffHour = Math.floor(absDiffMs / (60 * 60_000));
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay === 0 && !overdue) {
    if (diffHour === 0) return { text: t("dueSoon"), overdue: false };
    return { text: t("hoursLater", { count: diffHour }), overdue: false };
  }
  if (diffDay === 0 && overdue) return { text: t("overdue"), overdue: true };
  if (diffDay <= 7 && !overdue) return { text: t("daysLater", { count: diffDay }), overdue: false };
  if (diffDay <= 7 && overdue) return { text: t("daysAgo", { count: diffDay }), overdue: true };

  return {
    text: date.toLocaleDateString(),
    overdue,
  };
}

// ─── 组件 ──────────────────────────────────────────────────────────────────────

interface TodoWidgetProps {
  /** 工作区 ID */
  workspaceId: string;
  /** 查看全部回调（不传则跳转到 /dashboard/todos） */
  onViewAll?: () => void;
}

export default function TodoWidget({ workspaceId, onViewAll }: TodoWidgetProps) {
  const t = useTranslations("todo");

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [count, setCount] = useState<TodoCountResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载待办列表 + 计数 */
  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");

    try {
      const [todoData, countData] = await Promise.all([
        api<TodoItem[]>(
          `/api/v1/todos?workspaceId=${encodeURIComponent(workspaceId)}&type=all&status=pending&limit=5`,
          { signal: ac.signal },
        ),
        api<TodoCountResult>(`/api/v1/todos/count?workspaceId=${encodeURIComponent(workspaceId)}`, {
          signal: ac.signal,
        }),
      ]);

      if (ac.signal.aborted) return;
      setTodos(todoData);
      setCount(countData);
    } catch (e) {
      if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      if (process.env.NODE_ENV === "development") console.error("[TodoWidget] loadData error:", e);
      setError(t("error"));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [workspaceId, t]);

  useEffect(() => {
    loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

  /** 跳转到对应模块 */
  function navigateTo(sourceUrl: string) {
    window.open(sourceUrl, "_blank", "noopener,noreferrer");
  }

  /** 查看全部 */
  function handleViewAll() {
    if (onViewAll) {
      onViewAll();
    } else {
      window.open("/dashboard/todos", "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("title")}
    >
      {/* ── 头部：标题 + 今日待办数 ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-soft)]">
        <h3 className="flex items-center gap-1.5 text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <CheckSquare size={16} className="text-[var(--accent)]" />
          {t("today")}
        </h3>
        <span className="text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tabular-nums">
          {count?.total ?? 0}
        </span>
      </header>

      {/* ── 正文 ── */}
      <div className="px-4 py-3 space-y-1">
        {/* 错误态 */}
        {error && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-xs)]">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1 truncate">{error}</span>
          </div>
        )}

        {/* 加载态 */}
        {loading && (
          <div className="flex items-center justify-center py-6 text-[var(--muted)] text-[length:var(--text-xs)]">
            <Loader2 size={14} className="animate-spin mr-1.5" />
            {t("loading")}
          </div>
        )}

        {/* 空态 */}
        {!loading && todos.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-6 text-[var(--muted)] text-[length:var(--text-xs)] gap-1.5">
            <Inbox size={24} className="opacity-40" />
            <p>{t("noTodos")}</p>
          </div>
        )}

        {/* 待办列表（紧凑） */}
        {!loading && todos.length > 0 && (
          <div className="space-y-0.5">
            {todos.map((todo) => {
              const Icon = TYPE_ICON[todo.type];
              const dueInfo = todo.dueDate ? formatDueDate(todo.dueDate, t) : null;

              return (
                <button
                  key={`${todo.type}-${todo.id}`}
                  type="button"
                  onClick={() => navigateTo(todo.sourceUrl)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)] transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                >
                  <Icon size={14} className="shrink-0 text-[var(--muted)]" />
                  <span className="flex-1 min-w-0 text-[length:var(--text-xs)] text-[var(--fg)] truncate">
                    {todo.title}
                  </span>
                  {dueInfo && (
                    <span
                      className={`shrink-0 text-[length:var(--text-xs)] tabular-nums ${
                        dueInfo.overdue ? "text-[var(--danger)]" : "text-[var(--meta)]"
                      }`}
                    >
                      {dueInfo.text}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 底部：查看全部 ── */}
      {!loading && !error && (count?.total ?? 0) > 0 && (
        <footer className="px-4 py-2 border-t border-[var(--border-soft)]">
          <button
            type="button"
            onClick={handleViewAll}
            className="flex items-center justify-center gap-1 w-full text-[length:var(--text-xs)] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
          >
            {t("viewAll")}
            <ArrowRight size={14} />
          </button>
        </footer>
      )}
    </div>
  );
}
