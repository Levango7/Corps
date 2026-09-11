"use client";

/**
 * F3 Widget 仪表盘 — Widget 卡片外壳组件。
 *
 * 设计依据：design/FEATURE-DESIGN-v0.7.md §3.6。
 *
 * 职责：
 *  - 渲染标题栏（图标 + 标题 + 操作区）
 *  - 编辑模式下显示拖拽手柄（GripVertical）、配置按钮（Settings 齿轮）与删除按钮（X）
 *  - 内容区域渲染 children（各 Widget 自行加载与展示数据）
 *  - 所有样式走 design token（var(--*)），无裸 hex
 *
 * 交互：
 *  - 编辑模式：标题栏可拖拽（className="drag-handle" 由 RGL 识别），
 *    右上角显示配置按钮触发 onConfig，删除按钮触发 onRemove
 *  - 非编辑模式：标题栏静态，Widget 内部可正常交互
 *
 * 经验来源：2026-09-10-react-icon-size-prop-hardcoded-audit
 *   — 图标尺寸走档位值（16/14），不使用任意数值。
 */

import { useState, type ReactNode } from "react";
import { GripVertical, Settings, X } from "lucide-react";
import WidgetConfigPanel, { type WidgetConfig } from "./WidgetConfigPanel";

export interface WidgetCardProps {
  /** Widget 标题（已 i18n 渲染） */
  title: string;
  /** Widget 标题栏图标（lucide-react 组件） */
  icon?: React.ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  /** 是否处于编辑模式（显示拖拽手柄 + 配置按钮 + 删除按钮） */
  editing: boolean;
  /** 删除回调（编辑模式下点击 X 触发） */
  onRemove?: () => void;
  /** Widget 内容（各 Widget 组件自行加载与渲染） */
  children: ReactNode;
  /** 可选：标题栏右侧额外操作区（如刷新按钮） */
  headerExtra?: ReactNode;
  /** 可选：aria-label 用于无障碍 */
  ariaLabel?: string;
  /** Widget id（用于配置面板渲染对应配置项） */
  widgetId?: string;
  /** Widget 配置（编辑模式下点击齿轮按钮可修改） */
  config?: WidgetConfig;
  /** 配置变更回调（编辑模式下触发，由父组件持久化） */
  onConfigChange?: (config: WidgetConfig) => void;
}

export default function WidgetCard({
  title,
  icon: Icon,
  editing,
  onRemove,
  children,
  headerExtra,
  ariaLabel,
  widgetId,
  config,
  onConfigChange,
}: WidgetCardProps) {
  /** 是否打开配置面板 */
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div
      className="flex flex-col h-full bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] overflow-hidden"
      aria-label={ariaLabel ?? title}
    >
      {/* 标题栏 */}
      <header
        className={[
          "flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-soft)]",
          editing ? "cursor-grab active:cursor-grabbing drag-handle" : "",
        ].join(" ")}
      >
        {editing && (
          <GripVertical
            size={14}
            className="shrink-0 text-[var(--meta)]"
            aria-hidden="true"
          />
        )}
        {Icon && (
          <Icon
            size={14}
            className="shrink-0 text-[var(--muted)]"
            strokeWidth={2}
          />
        )}
        <h3 className="flex-1 min-w-0 truncate text-[length:var(--text-sm)] font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {title}
        </h3>
        {headerExtra && <div className="shrink-0 flex items-center gap-1">{headerExtra}</div>}
        {editing && widgetId && onConfigChange && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfigOpen(true);
            }}
            className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label="configure widget"
          >
            <Settings size={14} />
          </button>
        )}
        {editing && onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--meta)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger-fg)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label="remove widget"
          >
            <X size={14} />
          </button>
        )}
      </header>
      {/* 内容区域 */}
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
      {/* 配置面板（编辑模式下点击齿轮按钮打开） */}
      {configOpen && widgetId && onConfigChange && (
        <WidgetConfigPanel
          widgetId={widgetId}
          config={config ?? {}}
          onChange={(next) => onConfigChange(next)}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}
