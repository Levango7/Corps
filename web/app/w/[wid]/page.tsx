"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import NewTaskDialog from "@/components/NewTaskDialog";
import { TaskListSkeleton, StatCardSkeleton } from "@/components/Skeleton";

type Status = "todo" | "doing" | "done";
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

const STATUS_META: Record<Status, { label: string; icon: typeof Circle; color: string }> = {
  todo: { label: "待办", icon: Circle, color: "var(--status-todo)" },
  doing: { label: "进行中", icon: CircleDot, color: "var(--status-doing)" },
  done: { label: "已完成", icon: CheckCircle2, color: "var(--status-done)" },
};

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
  return { text: d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }), color: "var(--meta)" };
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
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setTasks(await api<Task[]>(`/api/v1/workspaces/${wid}/tasks`));
    } catch {
      setTasks([]);
    } finally {
      setLoaded(true);
    }
  }, [wid]);

  useEffect(() => {
    load();
  }, [load]);

  const counts: Record<Status, number> = {
    todo: tasks.filter((t) => t.status === "todo").length,
    doing: tasks.filter((t) => t.status === "doing").length,
    done: tasks.filter((t) => t.status === "done").length,
  };

  const openTasks = tasks.filter((t) => t.status !== "done");
  const overdue = openTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date());
  const recent = [...tasks]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 8);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-6 gap-4">
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
          className="flex items-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-base)] shrink-0"
        >
          <Plus size={16} />
          新建任务
        </button>
      </div>

      {/* 统计卡片：加载时用骨架，就绪后 3 列网格（< sm 单列） */}
      {!loaded ? (
        <StatCardSkeleton />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
          {(["todo", "doing", "done"] as const).map((s) => {
            const meta = STATUS_META[s];
            const Icon = meta.icon;
            return (
              <Link
                key={s}
                href={`/w/${wid}/board`}
                className="group bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-5 hover:border-[var(--muted)] transition-colors duration-[var(--motion-fast)]"
              >
                <div className="flex items-center gap-2">
                  <Icon size={16} style={{ color: meta.color }} />
                  <span className="text-[length:var(--text-sm)] text-[var(--fg-2)]">{meta.label}</span>
                  <ArrowRight
                    size={14}
                    className="ml-auto text-[var(--meta)] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-fast)]"
                  />
                </div>
                <div className="mt-2 text-[length:var(--text-3xl)] font-[var(--weight-semibold)] text-[var(--fg)] tabular-nums tracking-[-0.02em]">
                  {counts[s]}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* 逾期提醒：inline banner，左侧 danger 色条 + 文案，< sm 仅显示计数 */}
      {loaded && overdue.length > 0 && (
        <div className="mb-6 flex items-center gap-2.5 bg-[var(--danger-soft)] border-l-2 border-[var(--danger)] rounded-[var(--radius-md)] px-4 py-2.5 text-[length:var(--text-sm)]">
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
        </div>
      )}

      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)]">
        <header className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[var(--border-soft)]">
          <h2 className="text-[length:var(--text-md)] font-[var(--weight-semibold)] text-[var(--fg)]">
            最近更新
          </h2>
          <Link
            href={`/w/${wid}/board`}
            className="flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)]"
          >
            全部
            <ArrowRight size={14} />
          </Link>
        </header>

        {!loaded ? (
          <TaskListSkeleton count={5} />
        ) : recent.length === 0 ? (
          <div className="px-5 py-14 flex flex-col items-center text-center">
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

      <NewTaskDialog
        wid={wid}
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={load}
      />
    </div>
  );
}
