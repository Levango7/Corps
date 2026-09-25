"use client";

/**
 * 白板画布工具栏：选择元素类型 + 删除工具。
 *
 * 工具：select（选择/移动）、sticky（便签）、text（文本）、
 *      rectangle（矩形）、ellipse（椭圆）、arrow（连线）、delete（删除）
 *
 * 样式全部走 design token，图标用 lucide-react（size 14/16）。
 */

import { useTranslations } from "next-intl";
import { MousePointer2, StickyNote, Type, Square, Circle, ArrowRight, Trash2 } from "lucide-react";

/** 画布工具枚举 */
export type WhiteboardTool =
  "select" | "sticky" | "text" | "rectangle" | "ellipse" | "arrow" | "delete";

interface ToolDef {
  id: WhiteboardTool;
  icon: typeof MousePointer2;
  labelKey: string;
}

const TOOLS: ToolDef[] = [
  { id: "select", icon: MousePointer2, labelKey: "toolSelect" },
  { id: "sticky", icon: StickyNote, labelKey: "toolSticky" },
  { id: "text", icon: Type, labelKey: "toolText" },
  { id: "rectangle", icon: Square, labelKey: "toolRectangle" },
  { id: "ellipse", icon: Circle, labelKey: "toolEllipse" },
  { id: "arrow", icon: ArrowRight, labelKey: "toolArrow" },
  { id: "delete", icon: Trash2, labelKey: "toolDelete" },
];

export function WhiteboardToolbar({
  tool,
  onToolChange,
}: {
  tool: WhiteboardTool;
  onToolChange: (tool: WhiteboardTool) => void;
}) {
  const t = useTranslations("whiteboard");

  return (
    <div
      role="toolbar"
      aria-label={t("title")}
      className="inline-flex items-center gap-1 p-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--elev-sm)]"
    >
      {TOOLS.map((def, idx) => {
        const Icon = def.icon;
        const active = tool === def.id;
        // 在 delete 工具前插入分隔线
        const showDivider = idx === TOOLS.length - 1;
        return (
          <div key={def.id} className="inline-flex items-center gap-1">
            {showDivider && (
              <span className="w-px h-5 bg-[var(--border-soft)] mx-0.5" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={() => onToolChange(def.id)}
              aria-pressed={active}
              aria-label={t(def.labelKey)}
              title={t(def.labelKey)}
              className={`inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "text-[var(--fg-2)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
              }`}
            >
              <Icon size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
