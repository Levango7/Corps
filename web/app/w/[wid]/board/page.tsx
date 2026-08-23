"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus, GripVertical, Kanban, List } from "lucide-react";
import { api } from "@/lib/api";
import NewTaskDialog from "@/components/NewTaskDialog";

interface Task {
  id: string;
  title: string;
  description?: string;
  status: "todo" | "in_progress" | "review" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  assignee?: { id: string; name: string; email: string };
  dueDate?: string;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

type ViewMode = "board" | "list";

const COLUMNS: { id: Task["status"]; title: string; color: string }[] = [
  { id: "todo", title: "待办", color: "var(--status-todo)" },
  { id: "in_progress", title: "进行中", color: "var(--status-doing)" },
  { id: "review", title: "评审", color: "var(--warn)" },
  { id: "done", title: "已完成", color: "var(--status-done)" },
];

const PRIORITY_COLORS: Record<Task["priority"], string> = {
  low: "var(--meta)",
  medium: "var(--muted)",
  high: "var(--warn)",
  urgent: "var(--danger)",
};

/** 优先级左侧色条颜色：low 透明（占位保持卡片左缘对齐），其余用语义色。 */
const PRIORITY_BAR_COLORS: Record<Task["priority"], string> = {
  low: "transparent",
  medium: "var(--muted)",
  high: "var(--warn)",
  urgent: "var(--danger)",
};

const PRIORITY_LABELS: Record<Task["priority"], string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

const STATUS_COLORS: Record<Task["status"], string> = {
  todo: "var(--status-todo)",
  in_progress: "var(--status-doing)",
  review: "var(--warn)",
  done: "var(--status-done)",
};

const STATUS_LABELS: Record<Task["status"], string> = {
  todo: "待办",
  in_progress: "进行中",
  review: "评审",
  done: "已完成",
};

/**
 * 计算把 taskId 移到 column 列 targetIndex 位置时所需的 sortOrder。
 * 采用前后邻居中值法：列首 → 首元素 -1；列尾 → 末元素 +1；中间 → (prev + next) / 2。
 */
function computeSortOrder(
  tasks: Task[],
  column: Task["status"],
  targetIndex: number,
  excludeId: string
): number {
  const columnTasks = tasks
    .filter((t) => t.status === column && t.id !== excludeId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  if (columnTasks.length === 0) return 0;
  if (targetIndex <= 0) return (columnTasks[0].sortOrder ?? 0) - 1;
  if (targetIndex >= columnTasks.length) {
    return (columnTasks[columnTasks.length - 1].sortOrder ?? 0) + 1;
  }
  const prev = columnTasks[targetIndex - 1];
  const next = columnTasks[targetIndex];
  return ((prev.sortOrder ?? 0) + (next.sortOrder ?? 0)) / 2;
}

/**
 * 把截止日期格式化为相对时间："今天" / "明天" / "N 天后" / "逾期 N 天"。
 * 以日期（00:00）粒度比较，避免时区与时分秒抖动。
 */
function formatRelativeDueDate(dueDate: string): {
  text: string;
  tone: "overdue" | "today" | "normal";
} {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 0) return { text: `逾期 ${-diffDays} 天`, tone: "overdue" };
  if (diffDays === 0) return { text: "今天", tone: "today" };
  if (diffDays === 1) return { text: "明天", tone: "normal" };
  return { text: `${diffDays} 天后`, tone: "normal" };
}

/** 生成专业任务 ID：CORP-XXXX（大写 mono），如 CORP-4A2B。 */
function formatTaskId(id: string): string {
  return `CORP-${id.slice(0, 4).toUpperCase()}`;
}

/** 截止时间标签：inline=true 用于单行内（"· 3天后"），否则独立一行。 */
function DueTag({ dueDate, inline = false }: { dueDate: string; inline?: boolean }) {
  const due = formatRelativeDueDate(dueDate);
  const toneClass =
    due.tone === "overdue"
      ? "text-[var(--danger)]"
      : due.tone === "today"
        ? "text-[var(--warn)]"
        : "text-[var(--muted)]";
  if (inline) return <span className={toneClass}>· {due.text}</span>;
  return <p className={`text-xs mt-1 ${toneClass}`}>{due.text}</p>;
}

export default function BoardPage({ params }: { params: Promise<{ wid: string }> }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<ViewMode>("board");
  // < md 单列选择器当前选中列
  const [activeColumn, setActiveColumn] = useState<Task["status"]>("todo");
  const { wid } = use(params);
  const router = useRouter();

  useEffect(() => {
    api<Task[]>(`/api/v1/workspaces/${wid}/tasks`)
      .then(setTasks)
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [wid]);

  async function load() {
    try {
      setTasks(await api<Task[]>(`/api/v1/workspaces/${wid}/tasks`));
    } catch {
      setTasks([]);
    }
  }

  /**
   * 同列内拖拽排序：把 taskId 移到 column 列的 targetIndex 位置。
   * 跨列拖拽也复用此函数（同时改 status + sortOrder）。
   * 乐观更新：先改本地 tasks，再 PATCH 后端。
   */
  async function handleReorder(taskId: string, targetIndex: number, column: Task["status"]) {
    if (!tasks.some((t) => t.id === taskId)) return;

    const newSortOrder = computeSortOrder(tasks, column, targetIndex, taskId);
    const newStatus = column;

    // 乐观更新：仅改被拖动任务的 status + sortOrder，渲染时按列分组并按 sortOrder 排序
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: newStatus, sortOrder: newSortOrder } : t
      )
    );

    try {
      await api(`/api/v1/workspaces/${wid}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, sortOrder: newSortOrder }),
      });
    } catch {
      /* 乐观更新失败：保留本地状态，用户可重试 */
    }
  }

  /** 拖到某个任务卡片上：插入到该任务的位置（之前） */
  async function handleDropOnTask(sourceTaskId: string, targetTaskId: string) {
    if (sourceTaskId === targetTaskId) return;
    const target = tasks.find((t) => t.id === targetTaskId);
    if (!target) return;

    const column = target.status;
    // 计算 target 在目标列中的位置（排除 source）
    const columnTasksExcl = tasks
      .filter((t) => t.status === column && t.id !== sourceTaskId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const targetIndex = columnTasksExcl.findIndex((t) => t.id === targetTaskId);
    if (targetIndex < 0) return;

    await handleReorder(sourceTaskId, targetIndex, column);
  }

  /** 拖到列空白处：移到该列末尾 */
  async function handleDropOnColumn(sourceTaskId: string, targetStatus: Task["status"]) {
    if (!tasks.some((t) => t.id === sourceTaskId)) return;

    const columnTasksExcl = tasks
      .filter((t) => t.status === targetStatus && t.id !== sourceTaskId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    await handleReorder(sourceTaskId, columnTasksExcl.length, targetStatus);
  }

  /**
   * 渲染单个看板列（列头 + 任务卡片列表）。
   * 单列选择器（< md）与多列布局（md 水平滚动 / lg 4 列网格）共用此渲染。
   * 列根元素带 min-w-[260px] flex-shrink-0 以支撑 md 水平滚动；lg 下 lg:min-w-0 让 grid 列自由收缩。
   */
  const renderColumn = (
    column: (typeof COLUMNS)[number],
    columnTasks: Task[]
  ): ReactNode => (
    <div
      key={column.id}
      className="bg-[var(--surface-2)] rounded-[var(--radius-lg)] p-4 min-h-[500px] min-w-[260px] flex-shrink-0 lg:min-w-0"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const taskId = e.dataTransfer.getData("text/plain");
        if (taskId) handleDropOnColumn(taskId, column.id);
      }}
    >
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[var(--border)]">
        <div
          className="w-2 h-2 rounded-full"
          style={{ background: column.color }}
        />
        <span className="font-medium text-[var(--fg)]">{column.title}</span>
        <span className="ml-auto text-xs text-[var(--muted)] bg-[var(--surface)] px-2 py-0.5 rounded-full">
          {columnTasks.length}
        </span>
      </div>

      <div className="space-y-2">
        {columnTasks.map((task) => (
          <div
            key={task.id}
            draggable
            onClick={() => router.push(`/w/${wid}/task/${task.id}`)}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-2.5 cursor-pointer hover:shadow-[var(--elev-hover)] hover:border-[var(--muted)] transition-all"
            style={{
              borderLeft: `3px solid ${PRIORITY_BAR_COLORS[task.priority]}`,
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", task.id);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const sourceId = e.dataTransfer.getData("text/plain");
              if (sourceId) handleDropOnTask(sourceId, task.id);
            }}
          >
            <div className="flex items-start gap-2">
              <GripVertical
                size={14}
                className="text-[var(--meta)] mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-[var(--muted)]">
                    {formatTaskId(task.id)}
                  </span>
                </div>
                <p className="text-sm font-medium text-[var(--fg)] truncate">
                  {task.title}
                </p>
                {task.dueDate && <DueTag dueDate={task.dueDate} />}
                {task.assignee && (
                  <div className="flex items-center gap-1 mt-2">
                    <div className="w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-xs flex items-center justify-center shrink-0">
                      {task.assignee.name?.[0]}
                    </div>
                    <span className="text-xs text-[var(--muted)] truncate">
                      {task.assignee.name}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  /** 列表视图排序：先按状态列顺序，再按 sortOrder。 */
  const sortedListTasks = tasks.slice().sort((a, b) => {
    const sa = COLUMNS.findIndex((c) => c.id === a.status);
    const sb = COLUMNS.findIndex((c) => c.id === b.status);
    if (sa !== sb) return sa - sb;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  let content: ReactNode;

  if (loading) {
    content = (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full"></div>
      </div>
    );
  } else if (tasks.length === 0) {
    content = (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--muted)]">
        <Kanban size={48} className="mb-4 opacity-40" />
        <p className="text-lg font-medium mb-2 text-[var(--fg-2)]">还没有任务</p>
        <p className="text-sm mb-4">创建第一个任务，开始跟踪进度</p>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
        >
          <Plus size={16} />
          新建任务
        </button>
      </div>
    );
  } else {
    content = (
      <div>
        <div className="flex items-center justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--fg)] mb-1">任务看板</h1>
            <p className="text-[var(--muted)] text-sm">{tasks.length} 个任务</p>
          </div>
          <div className="flex items-center gap-3">
            {/* 视图切换 < sm：仅图标按钮组 */}
            <div className="sm:hidden inline-flex items-center gap-1 p-1 bg-[var(--surface-2)] rounded-[var(--radius-md)]">
              <button
                onClick={() => setView("board")}
                className={`p-1.5 rounded-[var(--radius-sm)] transition-colors ${
                  view === "board"
                    ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
                aria-label="看板视图"
              >
                <Kanban size={16} />
              </button>
              <button
                onClick={() => setView("list")}
                className={`p-1.5 rounded-[var(--radius-sm)] transition-colors ${
                  view === "list"
                    ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
                aria-label="列表视图"
              >
                <List size={16} />
              </button>
            </div>
            {/* 视图切换 ≥ sm：toggle 按钮组（看板 | 列表） */}
            <div className="hidden sm:inline-flex items-center gap-1 p-1 bg-[var(--surface-2)] rounded-[var(--radius-md)]">
              <button
                onClick={() => setView("board")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-sm transition-colors ${
                  view === "board"
                    ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
                aria-label="看板视图"
              >
                <Kanban size={16} />
                看板
              </button>
              <button
                onClick={() => setView("list")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-sm transition-colors ${
                  view === "list"
                    ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
                aria-label="列表视图"
              >
                <List size={16} />
                列表
              </button>
            </div>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
            >
              <Plus size={16} />
              新建任务
            </button>
          </div>
        </div>

        {view === "board" ? (
          <>
            {/* < md：单列选择器（4 个 tab），只显示选中列，任务全宽 */}
            <div className="md:hidden">
              <div className="inline-flex items-center gap-1 p-1 bg-[var(--surface-2)] rounded-[var(--radius-md)] mb-4 w-full">
                {COLUMNS.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => setActiveColumn(col.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-[var(--radius-sm)] text-sm transition-colors ${
                      activeColumn === col.id
                        ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                        : "text-[var(--muted)] hover:text-[var(--fg)]"
                    }`}
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: col.color }}
                    />
                    {col.title}
                  </button>
                ))}
              </div>
              {renderColumn(
                COLUMNS.find((c) => c.id === activeColumn)!,
                tasks
                  .filter((t) => t.status === activeColumn)
                  .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              )}
            </div>

            {/* md：4 列水平滚动（每列 min-w-[260px]）；lg：4 列网格 */}
            <div className="hidden md:block">
              <div className="flex overflow-x-auto gap-4 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
                {COLUMNS.map((column) =>
                  renderColumn(
                    column,
                    tasks
                      .filter((t) => t.status === column.id)
                      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                  )
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* < md：卡片列表（纵向排列，紧凑卡片） */}
            <div className="md:hidden space-y-2">
              {sortedListTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => router.push(`/w/${wid}/task/${task.id}`)}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-3 cursor-pointer hover:shadow-[var(--elev-hover)] hover:border-[var(--muted)] transition-all"
                  style={{
                    borderLeft: `3px solid ${PRIORITY_BAR_COLORS[task.priority]}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-sm font-medium text-[var(--fg)] truncate flex-1">
                      {task.title}
                    </p>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        background: `${STATUS_COLORS[task.status]}20`,
                        color: STATUS_COLORS[task.status],
                      }}
                    >
                      {STATUS_LABELS[task.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                    <span className="font-mono">{formatTaskId(task.id)}</span>
                    {task.dueDate && <DueTag dueDate={task.dueDate} inline />}
                    {task.assignee && (
                      <div className="ml-auto flex items-center gap-1">
                        <div className="w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-xs flex items-center justify-center shrink-0">
                          {task.assignee.name?.[0]}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* ≥ md：表格形式，紧凑行高 h-10，行 hover 用 --surface-2 */}
            <div className="hidden md:block bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                    <th className="font-medium px-4 h-10">标题</th>
                    <th className="font-medium px-4 h-10">负责人</th>
                    <th className="font-medium px-4 h-10">优先级</th>
                    <th className="font-medium px-4 h-10">状态</th>
                    <th className="font-medium px-4 h-10">截止日期</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedListTasks.map((task) => (
                    <tr
                      key={task.id}
                      onClick={() => router.push(`/w/${wid}/task/${task.id}`)}
                      className="border-b border-[var(--border)] last:border-b-0 cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
                    >
                      <td className="px-4 h-10 text-[var(--fg)] font-medium truncate max-w-xs">
                        {task.title}
                      </td>
                      <td className="px-4 h-10 text-[var(--muted)]">
                        {task.assignee?.name ?? "—"}
                      </td>
                      <td className="px-4 h-10">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            background: `${PRIORITY_COLORS[task.priority]}20`,
                            color: PRIORITY_COLORS[task.priority],
                          }}
                        >
                          {PRIORITY_LABELS[task.priority]}
                        </span>
                      </td>
                      <td className="px-4 h-10">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            background: `${STATUS_COLORS[task.status]}20`,
                            color: STATUS_COLORS[task.status],
                          }}
                        >
                          {STATUS_LABELS[task.status]}
                        </span>
                      </td>
                      <td className="px-4 h-10 text-[var(--muted)]">
                        {task.dueDate
                          ? new Date(task.dueDate).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {content}
      <NewTaskDialog
        wid={wid}
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={load}
      />
    </>
  );
}
