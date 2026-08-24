"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  CheckCircle2,
  CircleDot,
  Circle,
  ArrowRight,
  CalendarClock,
  Flag,
  LayoutDashboard,
} from "lucide-react";
import { api } from "@/lib/api";
import { STATUS_META } from "@/lib/task-meta";
import NewTaskDialog from "@/components/NewTaskDialog";
import Onboarding from "@/components/Onboarding";
import { TaskListSkeleton, StatCardSkeleton } from "@/components/Skeleton";

// 与后端枚举严格一致（tasks 表 CHECK：todo/in_progress/review/done）
type Status = "todo" | "in_progress" | "review" | "done";
type Priority = "low" | "medium" | "high" | "urgent";

interface Task {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  dueDate?: string | null;
  updatedAt?: string;
  assignee?: { id: string; name: string | null; email: string } | null;
}

// 概览页三张统计卡：进行中 = in_progress + review 合并计数

const STAT_CARDS: {
  key: "todo" | "doing" | "done";
  label: string;
  icon: typeof Circle;
  color: string;
  match: (s: Status) => boolean;
}[] = [
  {
    key: "todo",
    label: "待办",
    icon: Circle,
    color: "var(--status-todo)",
    match: (s) => s === "todo",
  },
  {
    key: "doing",
    label: "进行中",
    icon: CircleDot,
    color: "var(--status-doing)",
    match: (s) => s === "in_progress" || s === "review",
  },
  {
    key: "done",
    label: "已完成",
    icon: CheckCircle2,
    color: "var(--status-done)",
    match: (s) => s === "done",
  },
];

const PRIORITY_COLOR: Record<Priority, string> = {
  low: "var(--meta)",
  medium: "var(--muted)",
  high: "var(--warn)",
  urgent: "var(--danger)",
};

function dueMeta(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: `逾期 ${Math.abs(days)} 天`, color: "var(--danger)" };
  if (days === 0) return { text: "今天到期", color: "var(--warn)" };
  if (days === 1) return { text: "明天到期", color: "var(--warn)" };
  if (days <= 7) return { text: `${days} 天后`, color: "var(--muted)" };
  return {
    text: d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    color: "var(--meta)",
  };
}

/** 相对时间戳：刚刚 / N 分钟前 / N 小时前 / N 天前 / 月-日 */
function relativeTime(iso?: string) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export default function HomePage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);
  // Onboarding 引导：用户完成或跳过后本地标记，避免重复弹窗
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // "最近更新"列表排序方式：recent 最近更新 / due 即将到期 / priority 优先级
  const [sortKey, setSortKey] = useState<"recent" | "due" | "priority">("recent");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setTasks(await api<Task[]>(`/api/v1/workspaces/${wid}/tasks`));
    } catch (e) {
      setError(e instanceof Error && e.message.includes("fetch") ? "网络连接失败，请检查网络" : "加载失败，请稍后重试");
      setTasks([]);
    } finally {
      setLoaded(true);
    }
  }, [wid]);

  useEffect(() => {
    load();
  }, [load]);

  const counts: Record<"todo" | "doing" | "done", number> = {
    todo: tasks.filter((t) => STAT_CARDS[0].match(t.status)).length,
    doing: tasks.filter((t) => STAT_CARDS[1].match(t.status)).length,
    done: tasks.filter((t) => STAT_CARDS[2].match(t.status)).length,
  };

  const openTasks = tasks.filter((t) => t.status !== "done");
  const overdue = openTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date());

  /**
   * "最近更新"列表排序：
   * - recent：按 updatedAt 倒序（默认）
   * - due：按截止日期升序，无截止日期排最后
   * - priority：urgent > high > medium > low
   */
  const PRIORITY_ORDER: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const sortedRecent = [...tasks].sort((a, b) => {
    if (sortKey === "due") {
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return aDue - bDue;
    }
    if (sortKey === "priority") {
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    }
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
  const recent = sortedRecent.slice(0, 8);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-[var(--space-6)] gap-[var(--space-4)]">
        <div>
          <h1 className="text-[length:var(--text-2xl)] font-[var(--weight-semibold)] text-[var(--fg)] tracking-[-0.01em]">
            概览
          </h1>
          <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
            {loaded
              ? openTasks.length === 0
                ? "当前没有进行中的任务。"
                : `${openTasks.length} 条任务未完成${overdue.length > 0 ? `，其中 ${overdue.length} 条已逾期` : ""}。`
              : "正在读取任务"}
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-base)] shrink-0 focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
        >
          <Plus size={16} />
          新建任务
        </button>
      </div>

      {/* 统计卡片：加载时用骨架，就绪后 3 列网格（< sm 单列） */}
      {!loaded ? (
        <StatCardSkeleton />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[var(--space-3)] sm:gap-[var(--space-4)] mb-[var(--space-6)]">
          {STAT_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.key}
                href={`/w/${wid}/board`}
                className="group bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-5 hover:border-[var(--muted)] transition-colors duration-[var(--motion-fast)]"
              >
                <div className="flex items-center gap-2">
                  <Icon size={16} style={{ color: card.color }} />
                  <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">
                    {card.label}
                  </span>
                  <ArrowRight
                    size={14}
                    className="ml-auto text-[var(--meta)] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-fast)]"
                  />
                </div>
                <div className="mt-2 text-[length:var(--text-3xl)] font-[var(--weight-semibold)] text-[var(--fg)] tabular-nums tracking-[-0.02em]">
                  {counts[card.key]}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => { setError(null); load(); }} className="text-red-600 underline hover:text-red-800">重试</button>
        </div>
      )}

      {/* 逾期提醒：inline banner，左侧 danger 色条 + 文案，< sm 仅显示计数 */}
      {loaded && overdue.length > 0 && (
        <div className="mb-[var(--space-6)] flex items-center gap-2.5 bg-[var(--danger-soft)] border-l-2 border-[var(--danger)] rounded-[var(--radius-md)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--text-sm)]">
          <CalendarClock size={15} className="shrink-0 text-[var(--danger)]" />
          <span className="shrink-0 font-[var(--weight-medium)] text-[var(--danger-fg)]">
            已逾期 {overdue.length} 条
          </span>
          <span className="hidden sm:inline shrink-0 text-[var(--meta)]">·</span>
          <span className="hidden sm:flex flex-1 min-w-0 items-center gap-0.5 text-[var(--fg-2)] overflow-hidden">
            {overdue.slice(0, 3).map((t, i) => (
              <span key={t.id} className="inline-flex min-w-0 items-center">
                {i > 0 && <span className="text-[var(--meta)] mx-1 shrink-0">、</span>}
                <Link
                  href={`/w/${wid}/task/${t.id}`}
                  className="truncate hover:text-[var(--accent)] transition-colors duration-[var(--motion-fast)]"
                >
                  {t.title}
                </Link>
              </span>
            ))}
            {overdue.length > 3 && <span className="text-[var(--meta)] ml-1 shrink-0">等</span>}
          </span>
          {/* 移动端（< sm）查看全部逾期任务链接 */}
          <Link
            href={`/w/${wid}/board`}
            className="sm:hidden ml-auto text-[var(--accent)] hover:underline"
          >
            查看全部
          </Link>
        </div>
      )}

      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)]">
        <header className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
            最近更新
          </h2>
          <div className="flex items-center gap-[var(--space-3)]">
            {/* 排序下拉：最近更新 / 即将到期 / 优先级 */}
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as "recent" | "due" | "priority")}
              aria-label="排序方式"
              className="text-[length:var(--text-sm)] text-[var(--fg-2)] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-md)] px-2 py-1 focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
            >
              <option value="recent">最近更新</option>
              <option value="due">即将到期</option>
              <option value="priority">优先级</option>
            </select>
            <Link
              href={`/w/${wid}/board`}
              className="flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
            >
              全部
              <ArrowRight size={14} />
            </Link>
          </div>
        </header>

        {!loaded ? (
          <TaskListSkeleton count={5} />
        ) : recent.length === 0 ? (
          <div className="px-5 py-[var(--space-12)] flex flex-col items-center text-center">
            <LayoutDashboard
              size={48}
              className="text-[var(--muted)] opacity-40 mb-4"
              strokeWidth={1.5}
            />
            <p className="text-[length:var(--text-base)] text-[var(--fg-2)]">
              这个工作区还没有任务。
            </p>
            <p className="mt-1 text-[length:var(--text-sm)] text-[var(--muted)]">
              先在看板建一条，把手里最紧的事放进来。
            </p>
            <button
              onClick={() => setShowNew(true)}
              className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)]"
            >
              <Plus size={15} />
              新建任务
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-soft)]">
            {recent.map((t) => {
              const due = dueMeta(t.dueDate);
              const rel = relativeTime(t.updatedAt);
              const StatusIcon = STATUS_META[t.status].icon;
              return (
                <li key={t.id}>
                  <Link
                    href={`/w/${wid}/task/${t.id}`}
                    className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
                  >
                    <StatusIcon
                      size={15}
                      className="shrink-0"
                      style={{ color: STATUS_META[t.status].color }}
                    />
                    <span
                      className={`flex-1 min-w-0 text-[length:var(--text-base)] truncate ${
                        t.status === "done"
                          ? "text-[var(--muted)] line-through decoration-[var(--border)]"
                          : "text-[var(--fg)]"
                      }`}
                    >
                      {t.title}
                    </span>
                    {/* 优先级图标：< sm 隐藏 */}
                    {(t.priority === "high" || t.priority === "urgent") && (
                      <Flag
                        size={13}
                        className="hidden sm:block shrink-0"
                        style={{ color: PRIORITY_COLOR[t.priority] }}
                      />
                    )}
                    {due && (
                      <span
                        className="shrink-0 text-[length:var(--text-xs)] tabular-nums"
                        style={{ color: due.color }}
                      >
                        {due.text}
                      </span>
                    )}
                    {/* 截止日期与相对时间戳之间的分隔符 */}
                    {due && rel && <span className="shrink-0 text-[var(--meta)]">·</span>}
                    {/* 相对时间戳：var(--meta) 色 */}
                    {rel && (
                      <span className="shrink-0 text-[length:var(--text-xs)] tabular-nums text-[var(--meta)]">
                        {rel}
                      </span>
                    )}
                    {/* 负责人头像：< sm 隐藏 */}
                    {t.assignee && (
                      <span
                        className="hidden sm:flex shrink-0 w-6 h-6 rounded-full bg-[var(--surface-3)] text-[var(--fg-2)] items-center justify-center text-[length:var(--text-xs)] font-[var(--weight-medium)]"
                        title={t.assignee.name || t.assignee.email}
                      >
                        {(t.assignee.name || t.assignee.email)[0]?.toUpperCase()}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <NewTaskDialog wid={wid} open={showNew} onClose={() => setShowNew(false)} onCreated={load} />

      {/* Onboarding 引导：仅在工作区无任务且未标记完成时显示 */}
      {loaded && !onboardingDismissed && (
        <Onboarding
          wid={wid}
          taskCount={tasks.length}
          memberCount={0}
          onDismiss={() => setOnboardingDismissed(true)}
        />
      )}
    </div>
  );
}
