"use client";

/**
 * 任务看板 · /w/[wid]/board
 *
 * 重构后职责：
 *  - 状态管理（tasks / view / 拖拽 / 多选 / 分页）
 *  - 数据加载 + 乐观更新
 *  - 编排子组件（BoardColumn / ListTable / ListCards / ViewToggle / BatchToolbar）
 *
 * 拆分前 751 行，拆分后主组件 ~280 行，子组件在 board-parts.tsx。
 * 共享类型/常量/工具从 lib/types、lib/task-meta、lib/format import，消除重复。
 */

import { use, useEffect, useRef, useState } from "react";

import { Plus, AlertCircle, CheckSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { track } from "@/lib/analytics";
import NewTaskDialog from "@/components/NewTaskDialog";
import { ViewToggle } from "@/components/ViewToggle";
import { BatchToolbar } from "@/components/BatchToolbar";
import { MilestoneFilter } from "@/components/MilestoneFilter";
import {
  BoardColumn,
  ListTable,
  ListCards,
  BoardSkeleton,
  BoardEmptyState,
  type DragStart,
} from "@/components/board-parts";
import type { Task, Status, Priority } from "@/lib/types";
import { COLUMNS } from "@/lib/task-meta";
import type { ViewMode } from "@/components/types";

const LIST_PAGE_SIZE = 50;

export default function BoardPage({ params }: { params: Promise<{ wid: string }> }) {
  const { wid } = use(params);
  const t = useTranslations("task");

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState<ViewMode>("board");
  // 里程碑筛选：'all' | 'null' | milestoneId
  const [milestoneFilter, setMilestoneFilter] = useState<string>("all");
  // < md 单列选择器当前选中列
  const [activeColumn, setActiveColumn] = useState<Task["status"]>("todo");
  // 拖拽视觉反馈
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  // 列表视图分页
  const [listPage, setListPage] = useState(1);
  // 多选模式（P2 批量操作）
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const dragStartRef = useRef<DragStart>(null);
  // T3.3：拖拽请求序号，防止旧请求覆盖新状态
  const dragSeqRef = useRef(0);

  useEffect(() => {
    setLoading(true);
    const query =
      milestoneFilter !== "all" ? `?milestone=${milestoneFilter}` : "";
    api<Task[]>(`/api/v1/workspaces/${wid}/tasks${query}`)
      .then((data) => {
        setError(null);
        setTasks(data);
      })
      .catch((e) => {
        setError(
          e instanceof Error && e.message.includes("fetch")
            ? "网络连接失败，请检查网络"
            : "加载失败，请稍后重试",
        );
        setTasks([]);
      })
      .finally(() => setLoading(false));
  }, [wid, milestoneFilter]);

  async function load() {
    try {
      setError(null);
      const query =
        milestoneFilter !== "all" ? `?milestone=${milestoneFilter}` : "";
      setTasks(await api<Task[]>(`/api/v1/workspaces/${wid}/tasks${query}`));
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("fetch")
          ? "网络连接失败，请检查网络"
          : "加载失败，请稍后重试",
      );
      setTasks([]);
    }
  }

  // ─── 拖拽排序 ───────────────────────────────────────────

  function computeSortOrder(
    tasks: Task[],
    column: Status,
    targetIndex: number,
    excludeId: string,
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

  async function handleReorder(taskId: string, targetIndex: number, column: Status) {
    if (!tasks.some((t) => t.id === taskId)) return;
    const newSortOrder = computeSortOrder(tasks, column, targetIndex, taskId);
    const seq = ++dragSeqRef.current;
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: column, sortOrder: newSortOrder } : t)),
    );
    try {
      await api(`/api/v1/workspaces/${wid}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: column, sortOrder: newSortOrder }),
      });
    } catch {
      // 仅当没有更新的拖拽操作时才回滚
      if (seq === dragSeqRef.current) {
        setDragError("移动失败，已恢复");
        await load();
        setTimeout(() => setDragError(null), 5000);
      }
    }
  }

  async function moveTaskByStep(taskId: string, delta: -1 | 1) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const columnTasks = tasks
      .filter((t) => t.status === task.status)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const currentIndex = columnTasks.findIndex((t) => t.id === taskId);
    if (currentIndex < 0) return;
    const targetIndex = currentIndex + delta;
    if (targetIndex < 0 || targetIndex >= columnTasks.length) return;
    await handleReorder(taskId, targetIndex, task.status);
  }

  async function handleDropOnTask(sourceTaskId: string, targetTaskId: string) {
    if (sourceTaskId === targetTaskId) return;
    const target = tasks.find((t) => t.id === targetTaskId);
    if (!target) return;
    const column = target.status;
    const columnTasksExcl = tasks
      .filter((t) => t.status === column && t.id !== sourceTaskId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const targetIndex = columnTasksExcl.findIndex((t) => t.id === targetTaskId);
    if (targetIndex < 0) return;
    await handleReorder(sourceTaskId, targetIndex, column);
  }

  async function handleDropOnColumn(sourceTaskId: string, targetStatus: Status) {
    if (!tasks.some((t) => t.id === sourceTaskId)) return;
    const columnTasksExcl = tasks
      .filter((t) => t.status === targetStatus && t.id !== sourceTaskId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    await handleReorder(sourceTaskId, columnTasksExcl.length, targetStatus);
  }

  // ─── 多选 + 批量操作（P2） ───────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  async function handleBatchUpdate(patch: { status?: Status; priority?: Priority }) {
    const ids = Array.from(selectedIds);
    const resp = await api<{ updated: number; skipped: number }>(
      `/api/v1/workspaces/${wid}/tasks/batch`,
      {
        method: "POST",
        body: JSON.stringify({ ids, action: "update", ...patch }),
      },
    );
    track("task_status_change", { batch: true, count: resp.updated, ...patch });
    await load();
    clearSelection();
    return resp;
  }

  async function handleBatchDelete() {
    const ids = Array.from(selectedIds);
    const resp = await api<{ deleted: number; skipped: number }>(
      `/api/v1/workspaces/${wid}/tasks/batch`,
      {
        method: "POST",
        body: JSON.stringify({ ids, action: "delete" }),
      },
    );
    await load();
    clearSelection();
    return resp;
  }

  // ─── 列表视图排序 + 分页 ─────────────────────────────────

  const sortedListTasks = tasks.slice().sort((a, b) => {
    const sa = COLUMNS.findIndex((c) => c.id === a.status);
    const sb = COLUMNS.findIndex((c) => c.id === b.status);
    if (sa !== sb) return sa - sb;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  const listTotalPages = Math.max(1, Math.ceil(sortedListTasks.length / LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listTotalPages);
  const paginatedListTasks = sortedListTasks.slice(
    (safeListPage - 1) * LIST_PAGE_SIZE,
    safeListPage * LIST_PAGE_SIZE,
  );
  const showListPagination = sortedListTasks.length > LIST_PAGE_SIZE;

  // ─── 渲染 ───────────────────────────────────────────────

  return (
    <>
      {dragError && (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-md)] border"
          style={{
            background: "color-mix(in srgb, var(--danger) 10%, transparent)",
            borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)",
            color: "var(--danger)",
          }}
        >
          <AlertCircle size={16} className="shrink-0" />
          <span className="text-[length:var(--text-sm)] font-medium">{dragError}</span>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => {
              setError(null);
              load();
            }}
            className="text-red-600 underline hover:text-red-800"
          >
            重试
          </button>
        </div>
      )}

      {loading ? (
        <BoardSkeleton />
      ) : tasks.length === 0 ? (
        <BoardEmptyState onCreate={() => setShowNew(true)} />
      ) : (
        <div>
          {/* 标题行 + 操作 */}
          <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
            <div>
              <h1 className="text-[length:var(--text-2xl)] font-semibold text-[var(--fg)] mb-1">
                {t("boardTitle")}
              </h1>
              <p className="text-[var(--muted)] text-[length:var(--text-sm)]">
                {tasks.length} {t("countUnit")}
                {selectionMode && ` · ${t("selected", { count: selectedIds.size })}`}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <MilestoneFilter
                wid={wid}
                value={milestoneFilter}
                onChange={setMilestoneFilter}
              />
              <ViewToggle view={view} onChange={setView} />
              {/* 多选切换按钮 */}
              <button
                onClick={() => {
                  setSelectionMode((v) => !v);
                  if (selectionMode) setSelectedIds(new Set());
                }}
                aria-pressed={selectionMode}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-md)] text-sm transition-colors ${
                  selectionMode
                    ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
                aria-label={t("multiSelect")}
              >
                <CheckSquare size={16} />
                <span className="hidden sm:inline">{t("multiSelect")}</span>
              </button>
              <button
                onClick={() => setShowNew(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] hover:bg-[var(--accent-hover)] transition-colors"
              >
                <Plus size={16} />
                {t("create")}
              </button>
            </div>
          </div>

          {view === "board" ? (
            <BoardView
              wid={wid}
              tasks={tasks}
              activeColumn={activeColumn}
              setActiveColumn={setActiveColumn}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              dragStartRef={dragStartRef}
              selectedIds={selectedIds}
              selectionMode={selectionMode}
              onToggleSelect={toggleSelect}
              onReorder={handleReorder}
              onDropOnTask={handleDropOnTask}
              onDropOnColumn={handleDropOnColumn}
              onMoveByStep={moveTaskByStep}
            />
          ) : (
            <ListView
              wid={wid}
              paginatedTasks={paginatedListTasks}
              selectedIds={selectedIds}
              selectionMode={selectionMode}
              onToggleSelect={toggleSelect}
              showListPagination={showListPagination}
              safeListPage={safeListPage}
              listTotalPages={listTotalPages}
              onPrevPage={() => setListPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
            />
          )}
        </div>
      )}

      <NewTaskDialog wid={wid} open={showNew} onClose={() => setShowNew(false)} onCreated={load} />

      {/* P2 批量操作工具栏 */}
      <BatchToolbar
        selectedIds={Array.from(selectedIds)}
        onClear={clearSelection}
        onUpdate={handleBatchUpdate}
        onDelete={handleBatchDelete}
      />
    </>
  );
}

// ─── 看板视图 ─────────────────────────────────────────────

interface BoardViewProps {
  wid: string;
  tasks: Task[];
  activeColumn: Status;
  setActiveColumn: (s: Status) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  dragStartRef: React.RefObject<DragStart>;
  selectedIds: Set<string>;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
  onReorder: (taskId: string, targetIndex: number, column: Status) => Promise<void>;
  onDropOnTask: (sourceId: string, targetId: string) => Promise<void>;
  onDropOnColumn: (sourceId: string, status: Status) => Promise<void>;
  onMoveByStep: (taskId: string, delta: -1 | 1) => Promise<void>;
}

function BoardView(props: BoardViewProps) {
  const { tasks, activeColumn, setActiveColumn } = props;
  return (
    <>
      {/* < md：单列选择器 */}
      <div className="md:hidden">
        <div className="inline-flex items-center gap-1 p-1 bg-[var(--surface-2)] rounded-[var(--radius-md)] mb-4 w-full">
          {COLUMNS.map((col) => (
            <button
              key={col.id}
              onClick={() => setActiveColumn(col.id)}
              aria-pressed={activeColumn === col.id}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-[var(--radius-sm)] text-sm transition-colors ${
                activeColumn === col.id
                  ? "bg-[var(--surface)] text-[var(--fg)] shadow-[var(--elev-sm)]"
                  : "text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }} />
              {col.title}
            </button>
          ))}
        </div>
        <BoardColumn
          column={COLUMNS.find((c) => c.id === activeColumn)!}
          columnTasks={tasks
            .filter((t) => t.status === activeColumn)
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))}
          {...props}
        />
      </div>

      {/* md：4 列水平滚动；lg：4 列网格 */}
      <div className="hidden md:block">
        <div className="flex overflow-x-auto gap-4 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
          {COLUMNS.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              columnTasks={tasks
                .filter((t) => t.status === column.id)
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))}
              {...props}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// ─── 列表视图 ─────────────────────────────────────────────

interface ListViewProps {
  wid: string;
  paginatedTasks: Task[];
  selectedIds: Set<string>;
  selectionMode: boolean;
  onToggleSelect: (id: string) => void;
  showListPagination: boolean;
  safeListPage: number;
  listTotalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
}

function ListView(props: ListViewProps) {
  const {
    paginatedTasks,
    selectedIds,
    selectionMode,
    onToggleSelect,
    showListPagination,
    safeListPage,
    listTotalPages,
    onPrevPage,
    onNextPage,
  } = props;
  return (
    <>
      <ListCards
        tasks={paginatedTasks}
        wid={props.wid}
        selectedIds={selectedIds}
        selectionMode={selectionMode}
        onToggleSelect={onToggleSelect}
      />
      <ListTable
        tasks={paginatedTasks}
        wid={props.wid}
        selectedIds={selectedIds}
        selectionMode={selectionMode}
        onToggleSelect={onToggleSelect}
      />
      {showListPagination && (
        <div className="flex items-center justify-center gap-3 mt-4 text-[length:var(--text-sm)] text-[var(--muted)]">
          <button
            onClick={onPrevPage}
            disabled={safeListPage <= 1}
            className="px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="上一页"
          >
            上一页
          </button>
          <span className="tabular-nums text-[var(--fg-2)]">
            {safeListPage} / {listTotalPages}
          </span>
          <button
            onClick={onNextPage}
            disabled={safeListPage >= listTotalPages}
            className="px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--border)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="下一页"
          >
            下一页
          </button>
        </div>
      )}
    </>
  );
}
