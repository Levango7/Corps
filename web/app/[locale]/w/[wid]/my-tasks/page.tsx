"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ClipboardList, ChevronDown, SearchX } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { useTranslations } from "next-intl";

interface Task {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | Task["status"];
type SortKey = "recent" | "due" | "priority";

// 状态分组/筛选项/标签：走共享 lib/task-meta（阶段 2-6 i18n——titleKey 经 tStatus 渲染）
import { STATUS_FILTERS, STATUS_LABEL_KEYS, COLUMNS as STATUS_GROUPS } from "@/lib/task-meta";

/**
 * 状态徽章：用 color-mix 替代 `${color}20` alpha 拼接。
 * var(--token) 不能与十六进制透明度后缀组合，color-mix 是 W3C 标准方案，且能随主题切换重算。
 */
const STATUS_BADGE_STYLES: Record<Task["status"], { background: string; color: string }> = {
  todo: {
    background: "color-mix(in srgb, var(--status-todo) 12%, transparent)",
    color: "var(--status-todo)",
  },
  in_progress: {
    background: "color-mix(in srgb, var(--status-doing) 12%, transparent)",
    color: "var(--status-doing)",
  },
  review: { background: "color-mix(in srgb, var(--warn) 14%, transparent)", color: "var(--warn)" },
  done: {
    background: "color-mix(in srgb, var(--status-done) 12%, transparent)",
    color: "var(--status-done)",
  },
};

/**
 * 优先级左侧 4px 色条：urgent=红 / high=橙 / medium=蓝 / low=灰。
 * medium 用 --accent（项目里 --status-doing 即 --accent，蓝为品牌色）。
 */
const PRIORITY_BAR_COLORS: Record<Task["priority"], string> = {
  low: "var(--muted)",
  medium: "var(--accent)",
  high: "var(--warn)",
  urgent: "var(--danger)",
};

/** 优先级排序权重：urgent > high > medium > low */
const PRIORITY_ORDER: Record<Task["priority"], number> = { urgent: 0, high: 1, medium: 2, low: 3 };

// formatRelativeDueDate：走共享 lib/format.ts（tTime 注入渲染当前语言）
import { formatRelativeDueDate as sharedFormatRelativeDueDate } from "@/lib/format";

/**
 * 分组内排序：
 * - recent：按 updatedAt 倒序（默认）
 * - due：按截止日期升序，无截止日期排最后
 * - priority：urgent > high > medium > low
 */
function sortTasks(tasks: Task[], sortKey: SortKey): Task[] {
  const arr = tasks.slice();
  if (sortKey === "due") {
    arr.sort((a, b) => {
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return aDue - bDue;
    });
  } else if (sortKey === "priority") {
    arr.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  } else {
    arr.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }
  return arr;
}

export default function MyTasksPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);

  const t = useTranslations("task");
  const tStatus = useTranslations("status");
  const tErr = useTranslations("error");
  const tNav = useTranslations("nav");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 兼容两种响应形态：直接数组（与 /tasks 一致）或 { tasks: [...] }（assignee=me 约定）
    api<Task[] | { tasks: Task[] }>(`/api/v1/workspaces/${wid}/tasks?assignee=me`)
      .then((data) => {
        if (cancelled) return;
        setError(null);
        const list = Array.isArray(data) ? data : (data?.tasks ?? []);
        setTasks(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e instanceof Error && e.message.includes("fetch")
              ? tErr("networkConnectFailed")
              : tErr("loadFailed"),
          );
          setTasks([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wid]);

  /** 当前筛选下需要展示的状态分组 */
  const visibleGroups =
    statusFilter === "all" ? STATUS_GROUPS : STATUS_GROUPS.filter((g) => g.id === statusFilter);

  /**
   * 筛选后无结果：有任务但当前筛选下所有可见组都为空。
   * 仅在单状态筛选且该状态无任务时触发（全部筛选下 tasks 非空必有一组非空）。
   */
  const filteredEmpty =
    !loading &&
    tasks.length > 0 &&
    visibleGroups.every((g) => tasks.filter((t) => t.status === g.id).length === 0);

  return (
    <div className="max-w-[800px] mx-auto">
      {/* 标题区 */}
      <div className="mb-[var(--space-6)]">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
          {tNav("menu.myTasks")}
        </h1>
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
          {loading ? t("loading") : t("myTasksCount", { count: tasks.length })}
        </p>
      </div>

      {/* 筛选栏：状态筛选（移动端横向滚动）+ 排序下拉 */}
      <div className="mb-[var(--space-5)] flex items-center gap-[var(--space-3)]">
        <div className="flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex items-center gap-1 p-1 bg-[var(--surface-2)] rounded-[var(--radius-md)]">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                aria-pressed={statusFilter === f.id}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[length:var(--text-sm)] whitespace-nowrap transition-colors duration-[var(--motion-fast)] ${
                  statusFilter === f.id
                    ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)] font-[var(--weight-medium)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
              >
                {f.color && (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: f.color }}
                  />
                )}
                {tStatus(f.titleKey)}
              </button>
            ))}
          </div>
        </div>
        {/* 排序下拉：appearance-none + 自定义 lucide 箭头 */}
        <div className="relative shrink-0">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label={t("sortAria")}
            className="appearance-none text-[length:var(--text-sm)] text-[var(--fg-2)] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-md)] pl-3 pr-8 py-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
          >
            <option value="recent">{t("sortRecent")}</option>
            <option value="due">{t("sortDue")}</option>
            <option value="priority">{t("sortPriority")}</option>
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
          />
        </div>
      </div>

      {/* 内容区 */}
      {loading ? (
        <MyTasksSkeleton />
      ) : tasks.length === 0 ? (
        <EmptyState />
      ) : filteredEmpty ? (
        <NoResultState />
      ) : (
        <div className="space-y-[var(--space-4)]">
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => {
                  setError(null);
                }}
                className="text-red-600 underline hover:text-red-800"
              >
                {tErr("retry")}
              </button>
            </div>
          )}
          {visibleGroups.map((group) => {
            const groupTasks = sortTasks(
              tasks.filter((t) => t.status === group.id),
              sortKey,
            );
            // 全部筛选下跳过空组，避免空占位；单状态筛选由 filteredEmpty 兜底
            if (statusFilter === "all" && groupTasks.length === 0) return null;
            return (
              <StatusGroup
                key={group.id}
                title={tStatus(group.titleKey)}
                color={group.color}
                count={groupTasks.length}
              >
                {groupTasks.map((task) => (
                  <TaskCard key={task.id} task={task} href={`/w/${wid}/task/${task.id}`} />
                ))}
              </StatusGroup>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 状态分组容器：标题（状态点 + 名称 + 计数）+ 卡片列表 */
function StatusGroup({
  title,
  color,
  count,
  children,
}: {
  title: string;
  color: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] overflow-hidden">
      <header className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-[var(--border-soft)]">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
          {title}
        </h2>
        <span className="ml-auto text-[length:var(--text-xs)] text-[var(--muted)] bg-[var(--surface-2)] px-2 py-0.5 rounded-full tabular-nums">
          {count}
        </span>
      </header>
      <div className="divide-y divide-[var(--border-soft)]">{children}</div>
    </section>
  );
}

/** 任务卡片：左侧 4px 优先级色条 + 标题 + 右侧截止日期与状态 badge */
function TaskCard({ task, href }: { task: Task; href: string }) {
  const tStatus = useTranslations("status");
  const tTime = useTranslations("time");
  const due = task.dueDate ? sharedFormatRelativeDueDate(task.dueDate, tTime) : null;
  return (
    <Link
      href={href}
      className="flex w-full items-center gap-[var(--space-3)] px-4 sm:px-5 py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
      style={{ borderLeft: `4px solid ${PRIORITY_BAR_COLORS[task.priority]}` }}
    >
      <span className="flex-1 min-w-0 text-[length:var(--text-base)] text-[var(--fg)] truncate">
        {task.title}
      </span>
      {/* 截止日期：逾期用 --danger，今天用 --warn，其余 --muted */}
      {due && (
        <span
          className={`shrink-0 text-[length:var(--text-xs)] tabular-nums ${
            due.tone === "overdue"
              ? "text-[var(--danger)]"
              : due.tone === "today"
                ? "text-[var(--warn)]"
                : "text-[var(--muted)]"
          }`}
        >
          {due.text}
        </span>
      )}
      {/* 状态 badge */}
      <span
        className="shrink-0 text-[length:var(--text-xs)] px-1.5 py-0.5 rounded-[var(--radius-sm)]"
        style={STATUS_BADGE_STYLES[task.status]}
      >
        {tStatus(STATUS_LABEL_KEYS[task.status])}
      </span>
    </Link>
  );
}

/** 空状态：当前用户没有任何被分配的任务 */
function EmptyState() {
  const tEmpty = useTranslations("empty");
  return (
    <div className="flex flex-col items-center justify-center text-center px-[var(--space-4)] py-[var(--space-12)]">
      <ClipboardList size={48} className="text-[var(--muted)] opacity-40 mb-4" strokeWidth={1.5} />
      <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">{tEmpty("noTasks")}</p>
      <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
        {tEmpty("noTasksForYou")}
      </p>
    </div>
  );
}

/** 筛选后无结果：有任务但当前筛选条件下无匹配 */
function NoResultState() {
  const tEmpty = useTranslations("empty");
  return (
    <div className="flex flex-col items-center justify-center text-center px-[var(--space-4)] py-[var(--space-12)]">
      <SearchX size={40} className="text-[var(--muted)] opacity-40 mb-3" strokeWidth={1.5} />
      <p className="text-[length:var(--text-sm)] text-[var(--muted)]">{tEmpty("noTasksMatch")}</p>
    </div>
  );
}

/**
 * 加载骨架：标题 + 筛选栏 + 2 个分组占位，每组 3 行卡片占位。
 * 尺寸与正式布局对齐，避免加载完成时布局跳动。
 */
function MyTasksSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      {/* 标题骨架 */}
      <div className="mb-[var(--space-6)]">
        <Skeleton className="h-8 w-32 mb-2" />
        <Skeleton className="h-4 w-20" />
      </div>
      {/* 筛选栏骨架 */}
      <div className="mb-[var(--space-5)] flex items-center gap-[var(--space-3)]">
        <Skeleton className="h-9 w-72 rounded-[var(--radius-md)]" />
        <Skeleton className="h-9 w-28 rounded-[var(--radius-md)]" />
      </div>
      {/* 分组骨架 × 2 */}
      <div className="space-y-[var(--space-4)]">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] overflow-hidden"
          >
            {/* 组头 */}
            <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-[var(--border-soft)]">
              <Skeleton className="w-2 h-2 rounded-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="ml-auto h-5 w-8 rounded-full" />
            </div>
            {/* 卡片行骨架 × 3 */}
            <div className="divide-y divide-[var(--border-soft)]">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                  <Skeleton
                    className="flex-1 h-4"
                    // 宽度在 65%~94% 间错落，避免机械感
                    style={{ maxWidth: `${65 + ((j * 17) % 30)}%` }}
                  />
                  <Skeleton className="shrink-0 w-12 h-3" />
                  <Skeleton className="shrink-0 w-12 h-5 rounded-[var(--radius-sm)]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
