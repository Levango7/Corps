"use client";

/**
 * WidgetGrid — 可拖拽排列的卡片网格布局组件。
 *
 * 设计目标：
 * - 纯原生 HTML5 Drag and Drop API 实现拖拽（不依赖 @dnd-kit / react-grid-layout）
 * - CSS Grid 实现网格布局，移动端自动单列
 * - 支持调整大小（resize handle，右下角拖拽改变 w/h）
 * - 拖拽时视觉反馈：opacity 变化 + 虚线占位
 * - 所有样式走 design token（var(--*)），无裸 hex
 * - lucide-react 图标 size 14/16
 *
 * 用法：
 *   <WidgetGrid
 *     widgets={[
 *       { id: "summary", title: "任务摘要", component: <TaskSummaryWidget wid={wid} />, defaultPosition: { x: 0, y: 0, w: 4, h: 2 } },
 *       { id: "activity", title: "活动流", component: <ActivityWidget wid={wid} />, defaultPosition: { x: 4, y: 0, w: 4, h: 3 } },
 *     ]}
 *     onLayoutChange={(layout) => persistLayout(layout)}
 *   />
 *
 * 网格列数：桌面 12 列，平板 8 列，移动 1 列（自动）。
 * 坐标系：x/y 为网格单元坐标，w/h 为跨列/跨行数。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from "react";
import { GripVertical, Maximize2 } from "lucide-react";

/** 单个 Widget 定义 */
export interface Widget {
  id: string;
  title: string;
  component: ReactNode;
  defaultPosition: WidgetPosition;
}

/** Widget 在网格中的位置（网格单元坐标） */
export interface WidgetPosition {
  /** 起始列（0-based） */
  x: number;
  /** 起始行（0-based） */
  y: number;
  /** 跨列数 */
  w: number;
  /** 跨行数 */
  h: number;
}

/** 布局映射：widgetId → position */
export type WidgetLayout = Record<string, WidgetPosition>;

interface WidgetGridProps {
  widgets: Widget[];
  /** 布局变化回调（拖拽 / resize 后触发） */
  onLayoutChange?: (layout: WidgetLayout) => void;
  /** 初始布局（受控可选；不传则用 defaultPosition） */
  initialLayout?: WidgetLayout;
  /** 是否禁用编辑（拖拽 / resize），默认 false */
  readOnly?: boolean;
}

/** 桌面网格总列数（与 CSS grid-template-columns 对齐） */
const DESKTOP_COLS = 12;
/** 单元格基础高度（px），行高 = CELL_SIZE * h */
const CELL_SIZE = 56;
/** 网格间距（px） */
const GRID_GAP = 12;
/** resize 最小尺寸约束 */
const MIN_W = 2;
const MIN_H = 1;
/** resize 最大尺寸约束 */
const MAX_W = DESKTOP_COLS;
const MAX_H = 8;

/**
 * 计算卡片在网格中的 CSS 样式（grid-column / grid-row）。
 * 桌面用 grid 定位，移动端由媒体查询自动单列覆盖。
 */
function getGridStyle(pos: WidgetPosition): CSSProperties {
  return {
    gridColumnStart: pos.x + 1,
    gridColumnEnd: pos.x + pos.w + 1,
    gridRowStart: pos.y + 1,
    gridRowEnd: pos.y + pos.h + 1,
    minHeight: pos.h * CELL_SIZE,
  };
}

export default function WidgetGrid({
  widgets,
  onLayoutChange,
  initialLayout,
  readOnly = false,
}: WidgetGridProps) {
  /** 当前布局：优先 initialLayout，否则从 widgets.defaultPosition 派生 */
  const [layout, setLayout] = useState<WidgetLayout>(() => {
    if (initialLayout) return { ...initialLayout };
    const derived: WidgetLayout = {};
    for (const w of widgets) {
      derived[w.id] = { ...w.defaultPosition };
    }
    return derived;
  });

  /** 当前拖拽中的 widget id */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** 拖拽悬停目标位置（用于占位虚线提示） */
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  /** resize 中的 widget id */
  const [resizingId, setResizingId] = useState<string | null>(null);

  /** resize 起始信息快照 */
  const resizeStartRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  /** 布局变化时通知外部 */
  const notifyLayoutChange = useCallback(
    (next: WidgetLayout) => {
      onLayoutChange?.(next);
    },
    [onLayoutChange],
  );

  /** 更新布局并通知 */
  const updateLayout = useCallback(
    (next: WidgetLayout) => {
      setLayout(next);
      notifyLayoutChange(next);
    },
    [notifyLayoutChange],
  );

  // —— 拖拽相关 ——

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      if (readOnly) return;
      setDraggingId(id);
      // HTML5 DnD：设置数据 + 拖拽影像（透明占位由 CSS opacity 控制）
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/widget-id", id);
    },
    [readOnly],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      if (readOnly || draggingId === null || draggingId === id) return;
      // 阻止默认行为以允许 drop
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverId(id);
    },
    [readOnly, draggingId],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("text/widget-id");
      if (!sourceId || sourceId === targetId) {
        setDraggingId(null);
        setDragOverId(null);
        return;
      }
      // 交换 source 与 target 的位置
      const sourcePos = layout[sourceId];
      const targetPos = layout[targetId];
      if (!sourcePos || !targetPos) {
        setDraggingId(null);
        setDragOverId(null);
        return;
      }
      const next: WidgetLayout = {
        ...layout,
        [sourceId]: { ...sourcePos, x: targetPos.x, y: targetPos.y },
        [targetId]: { ...targetPos, x: sourcePos.x, y: sourcePos.y },
      };
      updateLayout(next);
      setDraggingId(null);
      setDragOverId(null);
    },
    [layout, updateLayout],
  );

  // —— Resize 相关（鼠标拖拽右下角手柄改变 w/h）——

  const handleResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, id: string) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = layout[id];
      if (!pos) return;
      resizeStartRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        startW: pos.w,
        startH: pos.h,
      };
      setResizingId(id);
    },
    [readOnly, layout],
  );

  useEffect(() => {
    if (resizingId === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      // 鼠标位移 → 网格单元变化（每 CELL_SIZE px 算 1 单元）
      const dx = e.clientX - start.startX;
      const dy = e.clientY - start.startY;
      const deltaW = Math.round(dx / CELL_SIZE);
      const deltaH = Math.round(dy / CELL_SIZE);
      const nextW = Math.max(MIN_W, Math.min(MAX_W, start.startW + deltaW));
      const nextH = Math.max(MIN_H, Math.min(MAX_H, start.startH + deltaH));
      const currentPos = layout[start.id];
      if (!currentPos) return;
      if (currentPos.w === nextW && currentPos.h === nextH) return;
      const next: WidgetLayout = {
        ...layout,
        [start.id]: { ...currentPos, w: nextW, h: nextH },
      };
      // resize 过程中实时更新（不触发外部 notify，避免高频回调）
      setLayout(next);
    };

    const handleMouseUp = () => {
      // resize 结束时一次性通知外部
      if (resizeStartRef.current) {
        notifyLayoutChange(layout);
      }
      resizeStartRef.current = null;
      setResizingId(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingId, layout, notifyLayoutChange]);

  // —— 渲染 ——

  /** 网格容器样式：CSS Grid，桌面 12 列，间距 12px */
  const gridStyle = useMemo<CSSProperties>(
    () => ({
      display: "grid",
      gridTemplateColumns: `repeat(${DESKTOP_COLS}, minmax(0, 1fr))`,
      gap: GRID_GAP,
      // 自动行高，配合 gridRowStart/End 定位
      gridAutoRows: CELL_SIZE,
    }),
    [],
  );

  return (
    <div
      className="widget-grid"
      style={gridStyle}
      role="region"
      aria-label="可拖拽卡片网格"
    >
      {widgets.map((widget) => {
        const pos = layout[widget.id] ?? widget.defaultPosition;
        const isDragging = draggingId === widget.id;
        const isDragOver = dragOverId === widget.id && draggingId !== null;
        const isResizing = resizingId === widget.id;

        const itemStyle: CSSProperties = {
          ...getGridStyle(pos),
          opacity: isDragging ? 0.4 : 1,
          outline: isDragOver ? `2px dashed var(--accent)` : undefined,
          outlineOffset: isDragOver ? 2 : undefined,
        };

        return (
          <div
            key={widget.id}
            className={[
              "widget-grid__item",
              isDragging ? "widget-grid__item--dragging" : "",
              isDragOver ? "widget-grid__item--drag-over" : "",
              isResizing ? "widget-grid__item--resizing" : "",
              readOnly ? "" : "widget-grid__item--editable",
            ]
              .filter(Boolean)
              .join(" ")}
            style={itemStyle}
            draggable={!readOnly}
            onDragStart={(e) => handleDragStart(e, widget.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, widget.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, widget.id)}
            aria-label={widget.title}
          >
            {/* 卡片头部：拖拽手柄 + 标题 */}
            <div className="widget-grid__header">
              {!readOnly && (
                <span
                  className="widget-grid__grip"
                  aria-hidden
                  title="拖拽移动"
                >
                  <GripVertical size={14} />
                </span>
              )}
              <span className="widget-grid__title">{widget.title}</span>
            </div>

            {/* 卡片内容区 */}
            <div className="widget-grid__body">{widget.component}</div>

            {/* Resize 手柄（右下角） */}
            {!readOnly && (
              <div
                className="widget-grid__resize-handle"
                onMouseDown={(e) => handleResizeStart(e, widget.id)}
                role="separator"
                aria-orientation="vertical"
                aria-label="调整大小"
                tabIndex={0}
              >
                <Maximize2 size={14} aria-hidden />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}