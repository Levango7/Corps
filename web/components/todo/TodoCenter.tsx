"use client";

/**
 * 待办中心面板（跨模块待办聚合）。
 *
 * 交互流程：
 *  1. 挂载时并行调用 GET /api/v1/todos/count 获取统计 + GET /api/v1/todos 获取列表
 *  2. 顶部展示总待办数 + 按类型分布
 *  3. 类型过滤标签（全部/任务/审批/会议/文档）
 *  4. 待办列表：类型图标 + 标题 + 截止日期 + 优先级 + 来源链接
 *  5. 点击跳转到对应模块
 *
 * Design token 样式 + lucide-react 图标 size 14/16。
 * Props: { workspaceId }
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CheckSquare,
  ClipboardCheck,
  Video,
  FileText,
  Calendar,
  Loader2,
  AlertCircle,
  X,
  Inbox,
} from "lucide-react";
import { api } from "@/lib/api";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

type TodoType = "task" | "approval" | "meeting" | "document";
type TodoStatus = "pending" | "completed";
type FilterType = "all" | TodoType;

interface TodoItem {
  id: string;
  type: TodoType;
  title: string;
  description?: string;
  dueDate?: string;
  priority?: string;
  sourceUrl: string;
  status: TodoStatus;
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

/** 类型 → i18n key 映射 */
const TYPE_LABEL_KEY: Record<TodoType, string> = {
  task: "typeTask",
  approval: "typeApproval",
  meeting: "typeMeeting",
  document: "typeDocument",
};

/** 过滤标签配置 */
const FILTER_TABS: { key: FilterType; labelKey: string }[] = [
  { key: "all", labelKey: "filterAll" },
  { key: "task", labelKey: "typeTask" },
  { key: "approval", labelKey: "typeApproval" },
  { key: "meeting", labelKey: "typeMeeting" },
  { key: "document", labelKey: "typeDocument" },
];

/** 优先级 → 颜色 token 映射 */
const PRIORITY_COLOR: Record<string, string> = {
  urgent: "var(--danger)",
  high: "var(--prio-high-fg)",
  medium: "var(--prio-med-fg)",
  low: "var(--prio-low-fg)",
};

/** 优先级 → i18n key 映射 */
const PRIORITY_LABEL_KEY: Record<string, string> = {
  urgent: "high",
  high: "high",
  medium: "medium",
  low: "low",
};

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 格式化截止日期（简短相对时间，已过期标红） */
function formatDueDate(iso: string): { text: string; overdue: boolean } {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = date.getTime() - now;
  const overdue = diffMs < 0;

  const absDiffMs = Math.abs(diffMs);
  const diffHour = Math.floor(absDiffMs / (60 * 60_000));
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay === 0 && !overdue) {
    if (diffHour === 0) return { text: "即将到期", overdue: false };
    return { text: `${diffHour}小时后`, overdue: false };
  }
  if (diffDay === 0 && overdue) return { text: "已过期", overdue: true };
  if (diffDay <= 7 && !overdue) return { text: `${diffDay}天后`, overdue: false };
  if (diffDay <= 7 && overdue) return { text: `${diffDay}天前`, overdue: true };

  // 超过 7 天显示具体日期
  return {
    text: date.toLocaleDateString(),
    overdue,
  };
}

// ─── 组件 ──────────────────────────────────────────────────────────────────────

interface TodoCenterProps {
  /** 工作区 ID */
  workspaceId: string;
}

export default function TodoCenter({ workspaceId }: TodoCenterProps) {
  const t = useTranslations("todo");

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [count, setCount] = useState<TodoCountResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  // AbortController：组件卸载时中止进行中的请求
  const abortRef = useRef<AbortController | null>(null);

  /** 加载待办列表 + 计数 */
  const loadData = useCallback(
    async (currentFilter: FilterType) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError("");

      try {
        const typeParam = currentFilter === "all" ? "all" : currentFilter;
        const [todoData, countData] = await Promise.all([
          api<TodoItem[]>(
            `/api/v1/todos?workspaceId=${encodeURIComponent(workspaceId)}&type=${typeParam}&status=pending&limit=50`,
            { signal: ac.signal },
          ),
          api<TodoCountResult>(
            `/api/v1/todos/count?workspaceId=${encodeURIComponent(workspaceId)}`,
            { signal: ac.signal },
          ),
        ]);

        if (ac.signal.aborted) return;
        setTodos(todoData);
        setCount(countData);
      } catch (e) {
        if (
          ac.signal.aborted ||
          (e instanceof Error && e.name === "AbortError")
        )
          return;
        if (process.env.NODE_ENV === "development")
          console.error("[TodoCenter] loadData error:", e);
        setError(t("error"));
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    [workspaceId, t],
  );

  useEffect(() => {
    loadData(filter);
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, filter]);

  /** 切换过滤标签 */
  function handleFilterChange(next: FilterType) {
    if (next === filter) return;
    setFilter(next);
  }

  /** 跳转到对应模块 */
  function navigateTo(sourceUrl: string) {
    window.open(sourceUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
      aria-label={t("title")}
    >
      {/* ── 头部：标题 + 总数 ── */}
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
        <h2 className="flex items-center gap-2 text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          <CheckSquare size={16} className="text-[var(--accent)]" />
          {t("title")}
        </h2>
        {count && (
          <span className="text-[length:var(--text-xs)] text-[var(--muted)] tabular-nums">
            {t("count")}: {count.total}
          </span>
        )}
      </header>

      {/* ── 统计区：按类型分布 ── */}
      {count && (
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-soft)]">
          {(["task", "approval", "meeting", "document"] as TodoType[]).map(
            (type) => {
              const Icon = TYPE_ICON[type];
              const num = count.byType[type];
              return (
                <div
                  key={type}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--surface-2)]"
                >
                  <Icon size={14} className="text-[var(--muted)]" />
                  <span className="text-[length:var(--text-xs)] text-[var(--muted)]">
                    {t(TYPE_LABEL_KEY[type])}
                  </span>
                  <span className="text-[length:var(--text-xs)] font-[weight:var(--weight-semibold)] text-[var(--fg)] tabular-nums">
                    {num}
                  </span>
                </div>
              );
            },
          )}
        </div>
      )}

      {/* ── 过滤标签 ── */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-[var(--border-soft)]">
        {FILTER_TABS.map((tab) => {
          const isActive = filter === tab.key;
          const tabCount =
            tab.key === "all"
              ? count?.total ?? 0
              : count?.byType[tab.key as TodoType] ?? 0;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleFilterChange(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                isActive
                  ? "bg-[var(--accent-soft)] text-[var(--accent-soft-fg)] font-[weight:var(--weight-medium)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
              }`}
            >
              {t(tab.labelKey)}
              <span className="text-[length:var(--text-xs)] tabular-nums opacity-70">
                {tabCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── 正文 ── */}
      <div className="px-5 py-4 space-y-[var(--space-2)]">
        {/* 错误态 */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-[var(--radius-md)] bg-[var(--danger-soft)] text-[var(--danger-fg)] text-[length:var(--text-sm)]">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
              aria-label="close"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 加载态 */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-[length:var(--text-sm)]">
            <Loader2 size={16} className="animate-spin mr-2" />
            {t("loading")}
          </div>
        )}

        {/* 空态 */}
        {!loading && todos.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--muted)] text-[length:var(--text-sm)] gap-2">
            <Inbox size={32} className="opacity-40" />
            <p>{t("noTodos")}</p>
          </div>
        )}

        {/* 待办列表 */}
        {!loading && todos.length > 0 && (
          <div className="space-y-1">
            {todos.map((todo) => {
              const Icon = TYPE_ICON[todo.type];
              const dueInfo = todo.dueDate
                ? formatDueDate(todo.dueDate)
                : null;
              const prioColor = todo.priority
                ? PRIORITY_COLOR[todo.priority]
                : null;
              const prioLabelKey = todo.priority
                ? PRIORITY_LABEL_KEY[todo.priority]
                : null;

              return (
                <div
                  key={`${todo.type}-${todo.id}`}
                  className="group flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--radius-md)] hover:bg-[var(--surface-2)] transition-colors"
                >
                  {/* 类型图标 */}
                  <Icon
                    size={16}
                    className="shrink-0 text-[var(--accent)]"
                  />

                  {/* 主要内容（可点击跳转） */}
                  <button
                    type="button"
                    onClick={() => navigateTo(todo.sourceUrl)}
                    className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] rounded-[var(--radius-sm)]"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[length:var(--text-sm)] text-[var(--fg)] truncate font-[weight:var(--weight-medium)]">
                        {todo.title}
                      </span>
                      {/* 截止日期 */}
                      {dueInfo && (
                        <span
                          className={`shrink-0 text-[length:var(--text-xs)] tabular-nums ${
                            dueInfo.overdue
                              ? "text-[var(--danger)]"
                              : "text-[var(--meta)]"
                          }`}
                        >
                          {t("dueDate")}: {dueInfo.text}
                        </span>
                      )}
                    </div>
                    {todo.description && (
                      <p className="text-[length:var(--text-xs)] text-[var(--muted)] truncate mt-0.5">
                        {todo.description}
                      </p>
                    )}
                  </button>

                  {/* 优先级标签 */}
                  {prioColor && prioLabelKey && (
                    <span
                      className="shrink-0 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)]"
                      style={{
                        color: prioColor,
                        backgroundColor: "var(--surface-2)",
                      }}
                    >
                      {t(prioLabelKey)}
                    </span>
                  )}

                  {/* 状态标签 */}
                  <span
                    className={`shrink-0 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] ${
                      todo.status === "pending"
                        ? "bg-[var(--warn-soft)] text-[var(--warn)]"
                        : "bg-[var(--success-soft)] text-[var(--success)]"
                    }`}
                  >
                    {todo.status === "pending"
                      ? t("pending")
                      : t("completed")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}