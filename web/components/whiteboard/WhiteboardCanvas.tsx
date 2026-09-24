"use client";

/**
 * 白板画布组件：元素的创建、拖拽移动、调整大小、内联编辑、删除。
 *
 * 元素类型：sticky（便签）、text（文本）、rectangle（矩形）、
 *          ellipse（椭圆）、arrow（连线）
 *
 * 交互：
 *  - 工具栏选择工具后，点击画布空白创建元素
 *  - select 工具下：点击选中、拖拽移动、右下角手柄调整大小、双击编辑文本
 *  - delete 工具下：点击元素删除
 *  - 键盘 Delete/Backspace 删除选中元素
 *
 * 自动保存：elements 变化后 debounce 2 秒调用 PATCH API，用 AbortController 取消进行中请求。
 *
 * 拖拽用原生 onMouseDown/onMouseMove/onMouseUp + absolute 定位，不依赖外部库。
 * 所有样式走 design token，无裸 hex。
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { WhiteboardToolbar, type WhiteboardTool } from "./WhiteboardToolbar";

/** 白板元素类型 */
export type WhiteboardElementType = "sticky" | "text" | "rectangle" | "ellipse" | "arrow";

/** 白板元素结构（与 schema.prisma 中 data JSON 约定一致） */
export interface WhiteboardElement {
  id: string;
  type: WhiteboardElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  style?: {
    color?: string;
    background?: string;
    fontSize?: number;
  };
}

/** 拖拽状态 */
interface DragState {
  kind: "move" | "resize";
  id: string;
  startPointerX: number;
  startPointerY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

/** 新建元素的默认尺寸 */
const DEFAULT_SIZE: Record<WhiteboardElementType, { width: number; height: number }> = {
  sticky: { width: 160, height: 120 },
  text: { width: 200, height: 48 },
  rectangle: { width: 160, height: 100 },
  ellipse: { width: 140, height: 140 },
  arrow: { width: 160, height: 80 },
};

/** 生成元素 ID（前端临时 ID，保存后服务端不重新生成） */
function genElementId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 生成新元素 */
function createElement(type: WhiteboardElementType, x: number, y: number): WhiteboardElement {
  const size = DEFAULT_SIZE[type];
  const base: WhiteboardElement = {
    id: genElementId(),
    type,
    x: Math.round(x),
    y: Math.round(y),
    width: size.width,
    height: size.height,
    content: "",
  };
  if (type === "sticky") {
    base.style = { background: "var(--warning-soft)", color: "var(--fg)" };
  } else if (type === "text") {
    base.style = { color: "var(--fg)", fontSize: 16 };
  } else {
    base.style = { color: "var(--accent)" };
  }
  return base;
}

export function WhiteboardCanvas({
  wid,
  wbid,
  initialTitle,
  initialData,
}: {
  wid: string;
  wbid: string;
  initialTitle: string;
  initialData: unknown;
}) {
  const t = useTranslations("whiteboard");

  // 解析 initialData 为元素数组
  const parseElements = (data: unknown): WhiteboardElement[] => {
    if (Array.isArray(data)) return data as WhiteboardElement[];
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? (parsed as WhiteboardElement[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const [title, setTitle] = useState(initialTitle);
  const [elements, setElements] = useState<WhiteboardElement[]>(() => parseElements(initialData));
  const [tool, setTool] = useState<WhiteboardTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  // 自动保存：debounce timer + AbortController
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveAbortRef = useRef<AbortController | null>(null);
  // 版本号追踪：每次 elements 变化递增，save 时记录当前版本，成功后只清除对应版本的脏标记
  const versionRef = useRef(0);
  const savedVersionRef = useRef(0);
  // 避免首次渲染触发保存（initialData 已是服务端数据）
  const firstRunRef = useRef(true);
  // 保存最新 elements 引用，供卸载时 flush 保存使用
  const elementsRef = useRef<WhiteboardElement[]>(elements);
  elementsRef.current = elements;

  // ── 自动保存（debounce 2 秒）──
  const save = useCallback(async () => {
    // 检查是否有未保存的版本（versionRef > savedVersionRef）
    if (versionRef.current <= savedVersionRef.current) return;
    // 记录本次保存对应的版本号
    const savingVersion = versionRef.current;
    // 取消上一次进行中的请求
    saveAbortRef.current?.abort();
    const ac = new AbortController();
    saveAbortRef.current = ac;
    setSaving(true);
    try {
      await api(`/api/v1/workspaces/${wid}/whiteboards/${wbid}`, {
        method: "PATCH",
        body: JSON.stringify({ data: JSON.stringify(elements) }),
        signal: ac.signal,
      });
      // 只清除本次保存对应版本的脏标记；若期间有新改动，versionRef 已递增，仍为脏
      savedVersionRef.current = savingVersion;
      setSavedAt(new Date());
    } catch {
      // 保存失败保留脏标记，下次再试
    } finally {
      setSaving(false);
    }
  }, [wid, wbid, elements]);

  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    versionRef.current++;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      save();
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [elements, save]);

  // 卸载时 flush 保存（而非 abort），确保 2s 内离开页面不丢失更改
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // 若有未保存的改动，立即执行保存（不 abort 进行中的请求）
      if (versionRef.current > savedVersionRef.current) {
        // 用最新 elements 引用发送保存请求
        api(`/api/v1/workspaces/${wid}/whiteboards/${wbid}`, {
          method: "PATCH",
          body: JSON.stringify({ data: JSON.stringify(elementsRef.current) }),
        }).catch(() => {
          // 卸载后保存失败无法重试，静默
        });
      }
    };
  }, [wid, wbid]);

  // ── 全局鼠标移动/松开（拖拽）──
  useEffect(() => {
    if (!dragState) return;

    const onMove = (e: globalThis.MouseEvent) => {
      const dx = e.clientX - dragState.startPointerX;
      const dy = e.clientY - dragState.startPointerY;
      setElements((prev) =>
        prev.map((el) => {
          if (el.id !== dragState.id) return el;
          if (dragState.kind === "move") {
            return {
              ...el,
              x: Math.round(dragState.origX + dx),
              y: Math.round(dragState.origY + dy),
            };
          }
          // resize：右下角手柄，调整 width/height（最小 20）
          return {
            ...el,
            width: Math.max(20, Math.round(dragState.origW + dx)),
            height: Math.max(20, Math.round(dragState.origH + dy)),
          };
        }),
      );
    };

    const onUp = () => {
      setDragState(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState]);

  // ── 键盘删除选中元素 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // 编辑文本时不拦截
        if (editingId) return;
        if (selectedId) {
          e.preventDefault();
          setElements((prev) => prev.filter((el) => el.id !== selectedId));
          setSelectedId(null);
        }
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        setEditingId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, editingId]);

  // ── 画布点击：创建元素或取消选中 ──
  function handleCanvasMouseDown(e: MouseEvent<HTMLDivElement>) {
    // 仅处理点击画布空白（target === currentTarget）
    if (e.target !== e.currentTarget) return;
    if (tool === "select") {
      setSelectedId(null);
      setEditingId(null);
      return;
    }
    if (tool === "delete") return;
    // 创建新元素
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const el = createElement(tool, x, y);
    setElements((prev) => [...prev, el]);
    setSelectedId(el.id);
    // 便签/文本创建后立即进入编辑
    if (tool === "sticky" || tool === "text") {
      setEditingId(el.id);
    }
    // 创建后切回选择工具，便于连续操作
    setTool("select");
  }

  // ── 元素鼠标按下：选中 + 开始拖拽 ──
  function handleElementMouseDown(e: MouseEvent<HTMLDivElement>, el: WhiteboardElement) {
    e.stopPropagation();
    if (tool === "delete") {
      setElements((prev) => prev.filter((item) => item.id !== el.id));
      setSelectedId(null);
      return;
    }
    setSelectedId(el.id);
    if (tool !== "select") return;
    // select 工具下开始移动拖拽
    setDragState({
      kind: "move",
      id: el.id,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.width,
      origH: el.height,
    });
  }

  // ── 调整大小手柄鼠标按下 ──
  function handleResizeMouseDown(e: MouseEvent<HTMLDivElement>, el: WhiteboardElement) {
    e.stopPropagation();
    setDragState({
      kind: "resize",
      id: el.id,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.width,
      origH: el.height,
    });
  }

  // ── 双击进入文本编辑 ──
  function handleElementDoubleClick(e: MouseEvent<HTMLDivElement>, el: WhiteboardElement) {
    e.stopPropagation();
    if (el.type === "rectangle" || el.type === "ellipse" || el.type === "arrow") return;
    setEditingId(el.id);
    setSelectedId(el.id);
  }

  // ── 编辑文本内容 ──
  function handleEditChange(e: React.ChangeEvent<HTMLTextAreaElement>, id: string) {
    const value = e.target.value;
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, content: value } : el)));
  }

  function handleEditBlur() {
    setEditingId(null);
  }

  // ── 标题编辑 ──
  async function handleTitleBlur() {
    if (title === initialTitle) return;
    try {
      await api(`/api/v1/workspaces/${wid}/whiteboards/${wbid}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
    } catch {
      // 标题保存失败静默
    }
  }

  const selectedElement = elements.find((el) => el.id === selectedId) ?? null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg)]">
      {/* 顶部栏：标题 + 工具栏 + 保存状态 */}
      <header className="flex items-center gap-3 px-[var(--space-4)] py-[var(--space-2)] border-b border-[var(--border)] bg-[var(--surface)]">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          maxLength={200}
          aria-label={t("title")}
          className="flex-1 min-w-0 h-9 px-2 rounded-[var(--radius-md)] border border-transparent bg-transparent text-[length:var(--text-md)] font-[weight:var(--weight-semibold)] text-[var(--fg)] outline-none hover:border-[var(--border-soft)] focus-visible:border-[var(--border)] focus-visible:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)]"
        />
        <WhiteboardToolbar tool={tool} onToolChange={setTool} />
        <span className="shrink-0 text-[length:var(--text-xs)] text-[var(--meta)] min-w-[60px] text-right">
          {saving ? t("autoSaved") + "…" : savedAt ? t("autoSaved") : ""}
        </span>
      </header>

      {/* 画布区域 */}
      <div
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        className="relative flex-1 min-h-0 overflow-auto bg-[var(--surface-2)]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border-soft) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {elements.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {t("noWhiteboards")}
            </p>
          </div>
        )}

        {elements.map((el) => {
          const isSelected = el.id === selectedId;
          const isEditing = el.id === editingId;
          return (
            <div
              key={el.id}
              onMouseDown={(e) => handleElementMouseDown(e, el)}
              onDoubleClick={(e) => handleElementDoubleClick(e, el)}
              className={`absolute select-none ${isSelected ? "cursor-move" : "cursor-default"} ${
                tool === "delete" ? "cursor-pointer" : ""
              }`}
              style={{
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
              }}
            >
              {/* 元素渲染 */}
              <ElementRenderer element={el} isEditing={isEditing} onEditChange={handleEditChange} onEditBlur={handleEditBlur} />

              {/* 选中边框 + 调整大小手柄 */}
              {isSelected && !isEditing && (
                <>
                  <div
                    className="absolute inset-0 pointer-events-none border-2 border-[var(--accent)] rounded-[var(--radius-sm)]"
                    aria-hidden="true"
                  />
                  {/* 右下角调整大小手柄 */}
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, el)}
                    className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full bg-[var(--accent)] border-2 border-[var(--surface)] cursor-nwse-resize"
                    aria-label="resize"
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部状态栏：元素数量 */}
      <footer className="flex items-center justify-between px-[var(--space-4)] py-[var(--space-1)] border-t border-[var(--border)] bg-[var(--surface)] text-[length:var(--text-xs)] text-[var(--meta)]">
        <span>
          {t("elements")}: {elements.length}
        </span>
        {selectedElement && (
          <span>
            {t("toolSelect")}: {selectedElement.type} ({selectedElement.x}, {selectedElement.y})
          </span>
        )}
      </footer>
    </div>
  );
}

/** 元素渲染器：根据 type 渲染不同样式 */
function ElementRenderer({
  element,
  isEditing,
  onEditChange,
  onEditBlur,
}: {
  element: WhiteboardElement;
  isEditing: boolean;
  onEditChange: (e: React.ChangeEvent<HTMLTextAreaElement>, id: string) => void;
  onEditBlur: () => void;
}) {
  const { type, content, style, width, height } = element;

  // 便签和文本可编辑
  if (type === "sticky" || type === "text") {
    if (isEditing) {
      return (
        <textarea
          autoFocus
          value={content}
          onChange={(e) => onEditChange(e, element.id)}
          onBlur={onEditBlur}
          className="w-full h-full p-2 resize-none outline-none rounded-[var(--radius-md)] text-[length:var(--text-sm)] bg-transparent"
          style={{
            color: style?.color ?? "var(--fg)",
            fontSize: style?.fontSize ?? 14,
            background: type === "sticky" ? (style?.background ?? "var(--warning-soft)") : "transparent",
          }}
        />
      );
    }
    return (
      <div
        className="w-full h-full p-2 overflow-hidden rounded-[var(--radius-md)] text-[length:var(--text-sm)] whitespace-pre-wrap break-words"
        style={{
          color: style?.color ?? "var(--fg)",
          fontSize: style?.fontSize ?? 14,
          background: type === "sticky" ? (style?.background ?? "var(--warning-soft)") : "transparent",
          border: type === "sticky" ? "1px solid var(--border-soft)" : "none",
        }}
      >
        {content || (type === "sticky" ? "" : "")}
      </div>
    );
  }

  // 矩形
  if (type === "rectangle") {
    return (
      <div
        className="w-full h-full rounded-[var(--radius-sm)]"
        style={{
          border: `2px solid ${style?.color ?? "var(--accent)"}`,
          background: "transparent",
        }}
      />
    );
  }

  // 椭圆
  if (type === "ellipse") {
    return (
      <div
        className="w-full h-full"
        style={{
          border: `2px solid ${style?.color ?? "var(--accent)"}`,
          borderRadius: "50%",
          background: "transparent",
        }}
      />
    );
  }

  // 箭头：从左上到右下画一条带箭头的线
  if (type === "arrow") {
    return (
      <svg
        width={width}
        height={height}
        className="absolute inset-0 pointer-events-none"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <marker
            id={`arrow-${element.id}`}
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill={style?.color ?? "var(--accent)"} />
          </marker>
        </defs>
        <line
          x1="0"
          y1="0"
          x2={width}
          y2={height}
          stroke={style?.color ?? "var(--accent)"}
          strokeWidth="2"
          markerEnd={`url(#arrow-${element.id})`}
        />
      </svg>
    );
  }

  return null;
}