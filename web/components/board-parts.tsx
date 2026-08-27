"use client";

/**
 * 看板页内部子组件 —— 从 board/page.tsx 拆分。
 *
 * BoardColumn / BoardCard / ListTable / ListCard / BoardSkeleton / EmptyState
 * 原本内联在 751 行的 BoardPage 中，拆分后主组件仅保留状态 + 编排，
 * 各子组件职责单一，便于测试与复用。
 */

import { useRouter } from "next/navigation";
import { Plus, Kanban, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import { DueTag } from "@/components/DueTag";
import { TaskLabels } from "@/components/TaskLabels";
import type { Task } from "@/lib/types";
import {
  COLUMNS,
  PRIORITY_BAR_COLORS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  STATUS_BADGE_STYLES,
  PRIORITY_BADGE_STYLES,
} from "@/lib/task-meta";
import { formatTaskId } from "@/lib/format";

/** 拖拽起始位置：用于区分"拖拽"与"点击"，避免拖拽结束误触发跳转 */
export type DragStart = { x: number; y: number } | null;

interface BoardColumnProps {
  column: (typeof COLUMNS)[number];
  columnTasks: Task[];
  wid: string;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  dragStartRef: React.RefObject<DragStart>;
  selectedIds: Set<string>;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
  onReorder: (taskId: string, targetIndex: number, column: Task["status"]) => Promise<void>;
  onDropOnTask: (sourceId: string, targetId: string) => Promise<void>;
  onDropOnColumn: (sourceId: string, status: Task["status"]) => Promise<void>;
  onMoveByStep: (taskId: string, delta: -1 | 1) => Promise<void>;
}

/** 单个看板列：列头 + 任务卡片列表。 */
export function BoardColumn({
  column,
  columnTasks,
  wid,
  draggingId,
  setDraggingId,
  dragStartRef,
  selectedIds,
  selectionMode,
  onToggleSelect,
  onReorder,
  onDropOnTask,
  onDropOnColumn,
  onMoveByStep,
}: BoardColumnProps) {
  return (
    <div
      className="bg-[var(--surface-2)] rounded-[var(--radius-lg)] p-4 min-h-[var(--board-col-min-h)] min-w-[var(--board-col-min-w)] flex-shrink-0 lg:min-w-0"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const taskId = e.dataTransfer.getData("text/plain");
        if (taskId) onDropOnColumn(taskId, column.id);
      }}
    >
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[var(--border)]">
        <div className="w-2 h-2 rounded-full" style={{ background: column.color }} />
        <span className="font-medium text-[var(--fg)]">{column.title}</span>
        <span className="ml-auto text-xs text-[var(--muted)] bg-[var(--surface)] px-2 py-0.5 rounded-full">
          {columnTasks.length}
        </span>
      </div>

      <div className="space-y-2">
        {columnTasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            wid={wid}
            draggingId={draggingId}
            setDraggingId={setDraggingId}
            dragStartRef={dragStartRef}
            selected={selectedIds.has(task.id)}
            selectionMode={selectionMode}
            onToggleSelect={onToggleSelect}
            onReorder={onReorder}
            onDropOnTask={onDropOnTask}
            onMoveByStep={onMoveByStep}
          />
        ))}
      </div>
    </div>
  );
}

interface BoardCardProps {
  task: Task;
  wid: string;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  dragStartRef: React.RefObject<DragStart>;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
  onReorder: (taskId: string, targetIndex: number, column: Task["status"]) => Promise<void>;
  onDropOnTask: (sourceId: string, targetId: string) => Promise<void>;
  onMoveByStep: (taskId: string, delta: -1 | 1) => Promise<void>;
}

/** 单个看板卡片：可拖拽 + 可选中 + 可点击跳转。 */
function BoardCard({
  task,
  wid,
  draggingId,
  setDraggingId,
  dragStartRef,
  selected,
  selectionMode,
  onToggleSelect,
  onDropOnTask,
  onMoveByStep,
}: BoardCardProps) {
  const router = useRouter();
  return (
    <div
      draggable={!selectionMode}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        if (selectionMode) {
          e.preventDefault();
          onToggleSelect(task.id);
          return;
        }
        // 拖拽与点击冲突：若拖拽距离 > 5px，视为拖拽而非点击，不触发跳转
        const start = dragStartRef.current;
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) {
          return;
        }
        router.push(`/w/${wid}/task/${task.id}`);
      }}
      onKeyDown={(e) => {
        if (selectionMode && (e.key === " " || e.key === "Enter")) {
          e.preventDefault();
          onToggleSelect(task.id);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/w/${wid}/task/${task.id}`);
        }
      }}
      className={`bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-2.5 cursor-pointer hover:shadow-[var(--elev-hover)] hover:border-[var(--muted)] transition-[box-shadow,border-color,opacity,transform] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none ${
        draggingId === task.id ? "opacity-50 rotate-2 scale-95" : ""
      } ${selected ? "ring-2 ring-[var(--accent)]" : ""}`}
      style={{
        borderLeft: `3px solid ${PRIORITY_BAR_COLORS[task.priority]}`,
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        setDraggingId(task.id);
      }}
      onDragEnd={() => {
        setDraggingId(null);
        dragStartRef.current = null;
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const sourceId = e.dataTransfer.getData("text/plain");
        if (sourceId) onDropOnTask(sourceId, task.id);
      }}
    >
      <div className="flex items-start gap-2">
        {/* 多选模式下显示复选框 */}
        {selectionMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(task.id)}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 shrink-0 accent-[var(--accent)]"
            aria-label={`选择任务 ${task.title}`}
          />
        )}
        <GripVertical size={14} className="text-[var(--meta)] mt-0.5 shrink-0 cursor-grab" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[length:var(--text-xs)] font-mono text-[var(--muted)]">
              {formatTaskId(task.id)}
            </span>
          </div>
          <p className="text-[length:var(--text-sm)] font-medium text-[var(--fg)] truncate">
            {task.title}
          </p>
          {task.dueDate && <DueTag dueDate={task.dueDate} />}
          {task.labels && task.labels.length > 0 && <TaskLabels labels={task.labels} />}
          {task.assignee && (
            <div className="flex items-center gap-1 mt-2">
              <div className="w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--accent-fg)] text-[length:var(--text-xs)] flex items-center justify-center shrink-0">
                {task.assignee.name?.[0]}
              </div>
              <span className="text-[length:var(--text-xs)] text-[var(--muted)] truncate">
                {task.assignee.name}
              </span>
            </div>
          )}
        </div>
        {/* 移动端上下移动按钮：触摸设备不支持 HTML5 DnD，提供显式按钮 */}
        <div className="md:hidden flex flex-col gap-0.5 shrink-0 -mr-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveByStep(task.id, -1);
            }}
            className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--muted)]"
            aria-label="上移"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMoveByStep(task.id, 1);
            }}
            className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--muted)]"
            aria-label="下移"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface ListTableProps {
  tasks: Task[];
  wid: string;
  selectedIds: Set<string>;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
}

/** 列表视图表格（≥ md） */
export function ListTable({
  tasks,
  wid,
  selectedIds,
  selectionMode,
  onToggleSelect,
}: ListTableProps) {
  const router = useRouter();
  return (
    <div className="hidden md:block bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
            {selectionMode && <th className="font-medium px-4 h-10 w-10" />}
            <th className="font-medium px-4 h-10">标题</th>
            <th className="font-medium px-4 h-10">负责人</th>
            <th className="font-medium px-4 h-10">优先级</th>
            <th className="font-medium px-4 h-10">状态</th>
            <th className="font-medium px-4 h-10">截止日期</th>
            <th className="font-medium px-4 h-10">标签</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const selected = selectedIds.has(task.id);
            return (
              <tr
                key={task.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (selectionMode) {
                    onToggleSelect(task.id);
                    return;
                  }
                  router.push(`/w/${wid}/task/${task.id}`);
                }}
                onKeyDown={(e) => {
                  if (selectionMode && (e.key === " " || e.key === "Enter")) {
                    e.preventDefault();
                    onToggleSelect(task.id);
                    return;
                  }
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/w/${wid}/task/${task.id}`);
                  }
                }}
                className={`border-b border-[var(--border)] last:border-b-0 cursor-pointer hover:bg-[var(--surface-2)] transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none ${
                  selected ? "bg-[var(--accent-soft)]" : ""
                }`}
              >
                {selectionMode && (
                  <td className="px-4 h-10 w-10">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleSelect(task.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-[var(--accent)]"
                      aria-label={`选择任务 ${task.title}`}
                    />
                  </td>
                )}
                <td className="px-4 h-10 text-[var(--fg)] font-medium truncate max-w-xs">
                  {task.title}
                </td>
                <td className="px-4 h-10 text-[var(--muted)]">{task.assignee?.name ?? "—"}</td>
                <td className="px-4 h-10">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={PRIORITY_BADGE_STYLES[task.priority]}
                  >
                    {PRIORITY_LABELS[task.priority]}
                  </span>
                </td>
                <td className="px-4 h-10">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={STATUS_BADGE_STYLES[task.status]}
                  >
                    {STATUS_LABELS[task.status]}
                  </span>
                </td>
                <td className="px-4 h-10 text-[var(--muted)]">
                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 h-10">
                  {task.labels && task.labels.length > 0 ? (
                    <TaskLabels labels={task.labels} max={2} />
                  ) : (
                    <span className="text-[var(--meta)]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ListCardProps {
  tasks: Task[];
  wid: string;
  selectedIds: Set<string>;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
}

/** 列表视图卡片（< md） */
export function ListCards({
  tasks,
  wid,
  selectedIds,
  selectionMode,
  onToggleSelect,
}: ListCardProps) {
  const router = useRouter();
  return (
    <div className="md:hidden space-y-2">
      {tasks.map((task) => {
        const selected = selectedIds.has(task.id);
        return (
          <div
            key={task.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (selectionMode) {
                onToggleSelect(task.id);
                return;
              }
              router.push(`/w/${wid}/task/${task.id}`);
            }}
            onKeyDown={(e) => {
              if (selectionMode && (e.key === " " || e.key === "Enter")) {
                e.preventDefault();
                onToggleSelect(task.id);
                return;
              }
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push(`/w/${wid}/task/${task.id}`);
              }
            }}
            className={`bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-3 cursor-pointer hover:shadow-[var(--elev-hover)] hover:border-[var(--muted)] transition-[box-shadow,border-color,opacity,transform] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none ${
              selected ? "ring-2 ring-[var(--accent)]" : ""
            }`}
            style={{
              borderLeft: `3px solid ${PRIORITY_BAR_COLORS[task.priority]}`,
            }}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {selectionMode && (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelect(task.id)}
                    className="shrink-0 accent-[var(--accent)]"
                    aria-label={`选择任务 ${task.title}`}
                  />
                )}
                <p className="text-sm font-medium text-[var(--fg)] truncate flex-1">{task.title}</p>
              </div>
              <span
                className="text-xs px-1.5 py-0.5 rounded shrink-0"
                style={STATUS_BADGE_STYLES[task.status]}
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
            {task.labels && task.labels.length > 0 && <TaskLabels labels={task.labels} />}
          </div>
        );
      })}
    </div>
  );
}

/** 看板骨架：标题行 + 4 列占位，每列 3 张卡片占位。 */
export function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <Skeleton className="h-7 w-28 mb-2" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-20 rounded-[var(--radius-md)]" />
          <Skeleton className="h-8 w-24 rounded-[var(--radius-md)]" />
        </div>
      </div>
      <div className="flex overflow-x-auto gap-4 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
        {COLUMNS.map((col) => (
          <div
            key={col.id}
            className="bg-[var(--surface-2)] rounded-[var(--radius-lg)] p-4 min-h-[var(--board-col-min-h)] min-w-[var(--board-col-min-w)] flex-shrink-0 lg:min-w-0"
          >
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[var(--border)]">
              <Skeleton className="w-2 h-2 rounded-full" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="ml-auto h-5 w-8 rounded-full" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-2.5"
                >
                  <Skeleton className="h-3 w-16 mb-2" />
                  <Skeleton className="h-4 w-full mb-1" style={{ maxWidth: `${70 + i * 8}%` }} />
                  <Skeleton className="h-3 w-20 mt-2" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 空状态：工作区无任务时引导创建。 */
export function BoardEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-[var(--muted)]">
      <Kanban size={48} className="mb-4 opacity-40" />
      <p className="text-[length:var(--text-lg)] font-medium mb-2 text-[var(--fg-2)]">还没有任务</p>
      <p className="text-[length:var(--text-sm)] mb-4">创建第一个任务，开始跟踪进度</p>
      <button
        onClick={onCreate}
        className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
      >
        <Plus size={16} />
        新建任务
      </button>
    </div>
  );
}
