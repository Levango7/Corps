"use client";

import type {
  Database,
  DatabaseField,
  DatabaseRecord,
  DatabaseView,
  Prisma,
} from "@prisma/client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  useOptimistic,
  type ReactElement,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GripVertical, Plus } from "lucide-react";
import { FieldControl } from "./FieldControls";

// ─── 常量 ───────────────────────────────────────────────────────────────────
/** 行高（px），虚拟滚动固定行高 */
const ROW_HEIGHT = 40;
/** 表头高度（px） */
const HEADER_HEIGHT = 36;
/** 行拖拽手柄列宽（px） */
const HANDLE_WIDTH = 40;
/** 默认列宽（px） */
const DEFAULT_COL_WIDTH = 160;
/** 列最小宽度（px） */
const MIN_COL_WIDTH = 60;
/** 虚拟滚动 overscan */
const OVERSCAN = 8;

// ─── Props ──────────────────────────────────────────────────────────────────
interface TableViewProps {
  database: Database;
  fields: DatabaseField[];
  records: DatabaseRecord[];
  view: DatabaseView;
  onRecordUpdate?: (id: string, data: Record<string, unknown>) => void;
  onRecordCreate?: () => void;
}

// ─── 辅助函数 ───────────────────────────────────────────────────────────────
/** 安全提取 record.data 为普通对象 */
function getRecordData(record: DatabaseRecord): Record<string, unknown> {
  const data = record.data;
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

/** 获取单元格值 */
function getCellValue(record: DatabaseRecord, fieldId: string): unknown {
  return getRecordData(record)[fieldId];
}

// ─── 列宽拖拽 Hook ──────────────────────────────────────────────────────────
function useColumnResize() {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const dragRef = useRef<{ fieldId: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      const next = Math.max(MIN_COL_WIDTH, drag.startWidth + delta);
      setWidths((prev) => ({ ...prev, [drag.fieldId]: next }));
    }
    function onUp() {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResize = (fieldId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentWidth = widths[fieldId] ?? DEFAULT_COL_WIDTH;
    dragRef.current = { fieldId, startX: e.clientX, startWidth: currentWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const getWidth = (fieldId: string): number =>
    widths[fieldId] ?? DEFAULT_COL_WIDTH;

  return { getWidth, startResize };
}

// ─── 单元格 ─────────────────────────────────────────────────────────────────
interface CellProps {
  record: DatabaseRecord;
  field: DatabaseField;
  isEditing: boolean;
  editValue: unknown;
  onStartEdit: () => void;
  onEditChange: (value: unknown) => void;
  onCommit: () => void;
}

function TableCell({
  record,
  field,
  isEditing,
  editValue,
  onStartEdit,
  onEditChange,
  onCommit,
}: CellProps): ReactElement {
  const value = isEditing ? editValue : getCellValue(record, field.id);

  return (
    <div
      className="w-full h-full overflow-hidden"
      onClick={(e) => {
        if (!isEditing) {
          e.stopPropagation();
          onStartEdit();
        }
      }}
      onBlur={(e) => {
        // 仅当焦点移出当前单元格时提交
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          onCommit();
        }
      }}
      style={
        isEditing
          ? {
              boxShadow: "inset 0 0 0 2px var(--accent-ring)",
              background: "var(--surface)",
            }
          : undefined
      }
    >
      <FieldControl
        field={field}
        value={value}
        onChange={onEditChange}
        readOnly={!isEditing}
      />
    </div>
  );
}

// ─── TableView ──────────────────────────────────────────────────────────────
export function TableView({
  database,
  fields,
  records,
  view: _view,
  onRecordUpdate,
  onRecordCreate,
}: TableViewProps): ReactElement {
  // 按 sortOrder 排序字段
  const sortedFields = useMemo(
    () => [...fields].sort((a, b) => a.sortOrder - b.sortOrder),
    [fields],
  );

  // 乐观更新记录
  const [optimisticRecords, addOptimisticUpdate] = useOptimistic(
    records,
    (
      state: DatabaseRecord[],
      update: { recordId: string; data: Record<string, unknown> },
    ): DatabaseRecord[] => {
      return state.map((r) => {
        if (r.id !== update.recordId) return r;
        return {
          ...r,
          data: {
            ...getRecordData(r),
            ...update.data,
          } as Prisma.JsonObject,
        };
      });
    },
  );

  const [, startTransition] = useTransition();

  // 编辑状态：当前正在编辑的单元格
  const [editingCell, setEditingCell] = useState<{
    recordId: string;
    fieldId: string;
    value: unknown;
  } | null>(null);

  // 列宽管理
  const { getWidth, startResize } = useColumnResize();

  // 虚拟滚动
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: optimisticRecords.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // 计算总宽度（用于水平滚动）
  const totalWidth = useMemo(
    () =>
      HANDLE_WIDTH +
      sortedFields.reduce((sum, f) => sum + getWidth(f.id), 0),
    [sortedFields, getWidth],
  );

  // 开始编辑单元格
  const startEditing = (record: DatabaseRecord, field: DatabaseField) => {
    setEditingCell({
      recordId: record.id,
      fieldId: field.id,
      value: getCellValue(record, field.id),
    });
  };

  // 提交编辑
  const commitEditing = () => {
    if (!editingCell) return;
    const { recordId, fieldId, value } = editingCell;
    startTransition(() => {
      addOptimisticUpdate({ recordId, data: { [fieldId]: value } });
      onRecordUpdate?.(recordId, { [fieldId]: value });
    });
    setEditingCell(null);
  };

  // 取消编辑（Escape 键）
  const cancelEditing = () => {
    setEditingCell(null);
  };

  // 全局 Escape 键取消编辑
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancelEditing();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 渲染行
  const renderRow = (record: DatabaseRecord, isHovered: boolean): ReactElement => {
    return (
      <div
        className="flex items-stretch border-b border-[var(--border)]"
        style={{
          width: totalWidth,
          height: ROW_HEIGHT,
          background: isHovered ? "var(--surface-2)" : "transparent",
        }}
      >
        {/* 拖拽手柄列 */}
        <div
          className="flex items-center justify-center shrink-0 border-r border-[var(--border)] text-[var(--meta)] hover:text-[var(--fg-2)] cursor-grab active:cursor-grabbing"
          style={{ width: HANDLE_WIDTH }}
        >
          <GripVertical size={14} />
        </div>
        {/* 数据列 */}
        {sortedFields.map((field) => {
          const isEditing =
            editingCell?.recordId === record.id &&
            editingCell?.fieldId === field.id;
          return (
            <div
              key={field.id}
              className="shrink-0 border-r border-[var(--border)] last:border-r-0"
              style={{ width: getWidth(field.id) }}
            >
              <TableCell
                record={record}
                field={field}
                isEditing={isEditing}
                editValue={editingCell?.value ?? null}
                onStartEdit={() => startEditing(record, field)}
                onEditChange={(v) =>
                  setEditingCell((prev) =>
                    prev ? { ...prev, value: v } : prev,
                  )
                }
                onCommit={commitEditing}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const virtualRows = rowVirtualizer.getVirtualItems();
  const isEmpty = optimisticRecords.length === 0;

  return (
    <div className="flex flex-col h-full bg-[var(--surface)] rounded-[var(--radius-sm)] border border-[var(--border)] overflow-hidden">
      {/* 数据库标题栏 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]">
        {database.emoji && (
          <span className="text-[length:var(--text-md)]">{database.emoji}</span>
        )}
        <span className="text-[length:var(--text-sm)] font-medium text-[var(--fg)] truncate">
          {database.title}
        </span>
        <span className="text-[length:var(--text-xs)] text-[var(--meta)] ml-auto tabular-nums">
          {optimisticRecords.length} 行 · {sortedFields.length} 列
        </span>
      </div>

      {/* 表头 + 虚拟滚动容器 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto min-h-0 relative"
      >
        {/* 表头（sticky） */}
        <div
          className="sticky top-0 z-10 flex items-stretch bg-[var(--surface-2)] border-b border-[var(--border)]"
          style={{ width: totalWidth, height: HEADER_HEIGHT }}
        >
          {/* 手柄列表头 */}
          <div
            className="flex items-center justify-center shrink-0 border-r border-[var(--border)]"
            style={{ width: HANDLE_WIDTH }}
          >
            <span className="text-[length:var(--text-xs)] text-[var(--meta)]">#</span>
          </div>
          {/* 字段列表头 */}
          {sortedFields.map((field) => (
            <div
              key={field.id}
              className="relative shrink-0 flex items-center px-2 border-r border-[var(--border)] last:border-r-0 group"
              style={{ width: getWidth(field.id) }}
            >
              <span className="text-[length:var(--text-sm)] font-medium text-[var(--fg-2)] truncate">
                {field.name}
              </span>
              <span className="ml-1.5 text-[length:var(--text-xs)] text-[var(--meta)] uppercase tracking-wider shrink-0">
                {field.type}
              </span>
              {/* 列宽拖拽手柄 */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "transparent" }}
                onMouseDown={(e) => startResize(field.id, e)}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "var(--accent)";
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "transparent";
                }}
              />
            </div>
          ))}
        </div>

        {/* 虚拟行区域 */}
        {isEmpty ? (
          <div
            className="flex items-center justify-center text-[length:var(--text-sm)] text-[var(--meta)]"
            style={{ height: 120 }}
          >
            暂无记录
          </div>
        ) : (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              width: totalWidth,
              position: "relative",
            }}
          >
            {virtualRows.map((virtualRow) => {
              const record = optimisticRecords[virtualRow.index];
              if (!record) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  className="absolute top-0 left-0"
                  style={{
                    width: totalWidth,
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <HoverRow
                    record={record}
                    isEditingRow={editingCell?.recordId === record.id}
                    renderRow={renderRow}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部新增行按钮 */}
      {onRecordCreate && (
        <div
          className="flex items-center gap-2 px-4 border-t border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          style={{ height: ROW_HEIGHT }}
          onClick={onRecordCreate}
        >
          <Plus size={14} className="text-[var(--meta)]" />
          <span className="text-[length:var(--text-sm)] text-[var(--meta)]">
            新增行
          </span>
        </div>
      )}
    </div>
  );
}

// ─── HoverRow（行 hover 状态管理） ──────────────────────────────────────────
interface HoverRowProps {
  record: DatabaseRecord;
  isEditingRow: boolean;
  renderRow: (record: DatabaseRecord, isHovered: boolean) => ReactElement;
}

function HoverRow({ record, isEditingRow, renderRow }: HoverRowProps): ReactElement {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="w-full h-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {renderRow(record, hovered || isEditingRow)}
    </div>
  );
}