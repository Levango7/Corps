"use client";

/**
 * 多维表格 · 看板视图（Phase 3C）
 *
 * 按 select / multiselect / user 字段分组，每组一列，卡片可拖拽跨列。
 * 拖拽用原生 HTML5 Drag & Drop API，不依赖 dnd-kit 等外部库。
 * 所有样式走 design token（var(--*)），无裸 hex。
 * 图标：lucide-react，尺寸 14。
 */

import { useState, useMemo, useCallback } from "react";
import { GripVertical } from "lucide-react";
import type { Database, DatabaseField, DatabaseRecord, DatabaseView } from "@prisma/client";
import { useTranslations } from "next-intl";

// ─── 类型与辅助函数 ──────────────────────────────────────────────

type RecordData = Record<string, unknown>;

/** 安全读取记录的 data JSON 对象 */
function readData(record: DatabaseRecord): RecordData {
  const d = record.data as unknown;
  if (d !== null && typeof d === "object" && !Array.isArray(d)) {
    return d as RecordData;
  }
  return {};
}

/** 读取记录中某字段的值 */
function getFieldValue(record: DatabaseRecord, fieldId: string): unknown {
  return readData(record)[fieldId] ?? null;
}

/** select / multiselect 选项 */
interface FieldChoice {
  id: string;
  name: string;
  color?: string;
}

/** 安全读取字段 options 中的 choices 列表 */
function readChoices(field: DatabaseField): FieldChoice[] {
  const o = field.options as unknown;
  if (o !== null && typeof o === "object" && !Array.isArray(o)) {
    const obj = o as { choices?: unknown };
    if (Array.isArray(obj.choices)) {
      return obj.choices as FieldChoice[];
    }
  }
  return [];
}

/** 安全读取视图 config */
function readConfig<T = RecordData>(view: DatabaseView): T {
  const c = view.config as unknown;
  if (c !== null && typeof c === "object" && !Array.isArray(c)) {
    return c as T;
  }
  return {} as T;
}

/** 解析日期值（支持 string / number / Date） */
function parseDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}


/** 获取字段值的显示文本（select 显示选项名、date 显示 M/D） */
function getFieldDisplayValue(record: DatabaseRecord, field: DatabaseField): string {
  const v = getFieldValue(record, field.id);
  if (v == null || v === "") return "";
  if (field.type === "select" || field.type === "multiselect") {
    const choices = readChoices(field);
    if (Array.isArray(v)) {
      return v
        .map((id) => choices.find((c) => c.id === id)?.name ?? String(id))
        .join(", ");
    }
    return choices.find((c) => c.id === v)?.name ?? String(v);
  }
  if (field.type === "date") {
    const d = parseDate(v);
    return d ? `${d.getMonth() + 1}/${d.getDate()}` : String(v);
  }
  return String(v);
}

/** 未分组占位 key */
const UNGROUPED = "__ungrouped__";

/** 列头默认色循环（design token） */
const COLUMN_COLORS = [
  "var(--muted)",
  "var(--accent)",
  "var(--success)",
  "var(--warn)",
  "var(--danger)",
];

// ─── Props ──────────────────────────────────────────────────────

export interface BoardViewProps {
  database: Database;
  fields: DatabaseField[];
  records: DatabaseRecord[];
  view: DatabaseView;
  onRecordUpdate?: (id: string, data: RecordData) => void;
}

interface BoardViewConfig {
  groupFieldId?: string;
}

// ─── 主组件 ──────────────────────────────────────────────────────

export function BoardView({ fields, records, view, onRecordUpdate }: BoardViewProps) {
  const t = useTranslations("database.boardView");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const config = readConfig<BoardViewConfig>(view);
  const groupField = config.groupFieldId
    ? fields.find((f) => f.id === config.groupFieldId)
    : undefined;

  const titleField = useMemo(
    () => fields.find((f) => f.type === "text") ?? fields[0],
    [fields],
  );

  const secondaryField = useMemo(
    () => fields.find((f) => f.id !== titleField?.id),
    [fields, titleField],
  );

  // 分组列定义
  const columns = useMemo(() => {
    if (!groupField) return [];
    const choices = readChoices(groupField);
    return [
      ...choices.map((c, i) => ({
        key: c.id,
        name: c.name,
        color: c.color ?? COLUMN_COLORS[i % COLUMN_COLORS.length],
      })),
      { key: UNGROUPED, name: t("ungrouped"), color: "var(--meta)" },
    ];
  }, [groupField, t]);

  // 按列分组记录
  const recordsByColumn = useMemo(() => {
    const colMap = new Map<string, DatabaseRecord[]>();
    for (const col of columns) colMap.set(col.key, []);
    if (!groupField || columns.length === 0) return colMap;

    for (const record of records) {
      const value = getFieldValue(record, groupField.id);
      if (groupField.type === "multiselect" && Array.isArray(value)) {
        if (value.length === 0) {
          colMap.get(UNGROUPED)?.push(record);
          continue;
        }
        let placed = false;
        for (const v of value) {
          const key = String(v);
          if (colMap.has(key)) {
            colMap.get(key)!.push(record);
            placed = true;
          }
        }
        if (!placed) colMap.get(UNGROUPED)?.push(record);
      } else {
        const key = value == null || value === "" ? UNGROUPED : String(value);
        if (colMap.has(key)) {
          colMap.get(key)!.push(record);
        } else {
          colMap.get(UNGROUPED)?.push(record);
        }
      }
    }
    return colMap;
  }, [columns, groupField, records]);

  const handleDrop = useCallback(
    (colKey: string, recordId: string) => {
      if (!groupField || !onRecordUpdate) return;
      const newValue = colKey === UNGROUPED ? null : colKey;
      onRecordUpdate(recordId, { [groupField.id]: newValue });
      setDraggingId(null);
      setDragOverCol(null);
    },
    [groupField, onRecordUpdate],
  );

  if (!groupField) {
    return (
      <div className="flex items-center justify-center min-h-[var(--board-col-min-h)] text-[var(--muted)] text-[length:var(--text-sm)]">
        {t("noGroupField")}
      </div>
    );
  }

  return (
    <div
      className="flex gap-4 overflow-x-auto pb-4"
      style={{ minHeight: "var(--board-col-min-h)" }}
    >
      {columns.map((col) => {
        const colRecords = recordsByColumn.get(col.key) ?? [];
        return (
          <div
            key={col.key}
            data-column={col.key}
            role="group"
            aria-label={col.name}
            className={[
              "bg-[var(--surface-2)] rounded-[var(--radius-lg)] p-3",
              "min-w-[var(--board-col-min-w)] flex-shrink-0",
              "transition-shadow duration-[var(--motion-fast)]",
              dragOverCol === col.key ? "ring-2 ring-[var(--accent-ring)]" : "",
            ].join(" ")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(col.key);
            }}
            onDragLeave={() => {
              setDragOverCol((prev) => (prev === col.key ? null : prev));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const recordId = e.dataTransfer.getData("text/plain");
              if (recordId) handleDrop(col.key, recordId);
            }}
          >
            {/* 列头 */}
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--border)]">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: col.color }}
              />
              <span className="font-[weight:var(--weight-medium)] text-[var(--fg)] text-[length:var(--text-sm)] truncate">
                {col.name}
              </span>
              <span className="ml-auto text-[length:var(--text-xs)] text-[var(--muted)] bg-[var(--surface)] px-2 py-0.5 rounded-full tabular-nums">
                {colRecords.length}
              </span>
            </div>

            {/* 卡片列表 */}
            <div className="space-y-2">
              {colRecords.map((record) => (
                <BoardCard
                  key={record.id}
                  record={record}
                  titleField={titleField}
                  secondaryField={secondaryField}
                  isDragging={draggingId === record.id}
                  onDragStart={() => setDraggingId(record.id)}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverCol(null);
                  }}
                />
              ))}
              {colRecords.length === 0 && (
                <div className="text-center py-8 text-[length:var(--text-xs)] text-[var(--meta)] border border-dashed border-[var(--border)] rounded-[var(--radius-md)]">
                  {t("dropHere")}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 卡片子组件 ──────────────────────────────────────────────────

interface BoardCardProps {
  record: DatabaseRecord;
  titleField?: DatabaseField;
  secondaryField?: DatabaseField;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function BoardCard({
  record,
  titleField,
  secondaryField,
  isDragging,
  onDragStart,
  onDragEnd,
}: BoardCardProps) {
  const t = useTranslations("database.boardView");
  const title = useMemo(() => {
    if (!titleField) return record.id.slice(0, 8);
    const display = getFieldDisplayValue(record, titleField);
    return display || t("untitled");
  }, [record, titleField, t]);

  const secondary = useMemo(() => {
    if (!secondaryField) return null;
    return getFieldDisplayValue(record, secondaryField) || null;
  }, [record, secondaryField]);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", record.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={[
        "bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-2.5",
        "cursor-grab active:cursor-grabbing",
        "transition-[box-shadow,border-color,opacity,transform] duration-[var(--motion-fast)]",
        "hover:shadow-[var(--elev-hover)] hover:border-[var(--muted)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none",
        isDragging ? "opacity-50 rotate-2 scale-95" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2">
        <GripVertical size={14} className="text-[var(--meta)] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] text-[var(--fg)] truncate">
            {title}
          </p>
          {secondary && (
            <p className="mt-1 text-[length:var(--text-xs)] text-[var(--muted)] truncate">
              {secondary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
