"use client";

/**
 * EmptyState · 通用空状态组件
 *
 * 提供 6 种内联 SVG 插画（inbox / folder / search / chart / calendar / users），
 * 用于各列表/面板无数据时的占位引导。所有色值走 var(--token)，SVG 用 currentColor
 * 继承文字颜色，保持暗色模式与主题切换一致。
 *
 * 设计规范：
 *  - 居中布局（flex column items-center justify-center）
 *  - SVG 尺寸 64px，颜色 text-[var(--meta)]
 *  - 标题 text-[var(--fg)] + font-[var(--weight-medium)] + text-base
 *  - 描述 text-[var(--meta)] + text-sm
 *  - 可选操作按钮复用项目现有 accent 按钮样式
 *  - 整体 py-12 垂直间距，支持 className 覆盖
 */

import type { ReactNode } from "react";

type EmptyStateType = "inbox" | "folder" | "search" | "chart" | "calendar" | "users";

interface EmptyStateProps {
  type: EmptyStateType;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

/** SVG 通用属性：48×48 viewBox，线条风格，currentColor 继承文字颜色。 */
const svgProps = {
  viewBox: "0 0 48 48",
  width: 64,
  height: 64,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** 收件箱：空盒子 + 上箭头（表示收件箱为空，可放入内容）。 */
function InboxIllustration() {
  return (
    <svg {...svgProps} role="img" aria-label="Empty inbox">
      {/* 盒子顶部折线（开口） */}
      <path d="M8 30 L16 30 L20 36 L28 36 L32 30 L40 30" />
      {/* 盒子底部 */}
      <path d="M8 30 L8 40 L40 40 L40 30" />
      {/* 上箭头：表示空、可放入 */}
      <path d="M24 22 L24 10" />
      <path d="M18 16 L24 10 L30 16" />
    </svg>
  );
}

/** 文件夹：打开的空文件夹。 */
function FolderIllustration() {
  return (
    <svg {...svgProps} role="img" aria-label="Empty folder">
      {/* 文件夹打开的顶部翻盖 */}
      <path d="M6 16 L20 16 L24 12 L42 12 L42 20" />
      {/* 文件夹主体 */}
      <path d="M6 16 L6 40 L42 40 L42 20" />
      {/* 空内容提示线（淡） */}
      <path d="M18 28 L30 28" opacity={0.4} />
    </svg>
  );
}

/** 搜索：放大镜 + 问号（表示未找到匹配内容）。 */
function SearchIllustration() {
  return (
    <svg {...svgProps} role="img" aria-label="No search results">
      {/* 放大镜圆 */}
      <circle cx="21" cy="21" r="12" />
      {/* 放大镜柄 */}
      <path d="M30 30 L40 40" />
      {/* 问号曲线 */}
      <path d="M17 18 Q17 14 21 14 Q25 14 25 18 Q25 20 21 22" />
      {/* 问号点 */}
      <circle cx="21" cy="27" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 图表：柱状图 + 趋势线（表示暂无数据）。 */
function ChartIllustration() {
  return (
    <svg {...svgProps} role="img" aria-label="No chart data">
      {/* X 轴 */}
      <path d="M8 40 L40 40" />
      {/* 柱状图（递增） */}
      <path d="M13 40 L13 33" />
      <path d="M21 40 L21 28" />
      <path d="M29 40 L29 23" />
      <path d="M37 40 L37 18" />
      {/* 趋势线（连接柱顶） */}
      <path d="M13 33 L21 28 L29 23 L37 18" opacity={0.6} />
    </svg>
  );
}

/** 日历：空日历（表示暂无日程）。 */
function CalendarIllustration() {
  return (
    <svg {...svgProps} role="img" aria-label="Empty calendar">
      {/* 日历外框 */}
      <rect x="8" y="12" width="32" height="28" rx="2" />
      {/* 顶部分隔线 */}
      <path d="M8 20 L40 20" />
      {/* 装订线（左右两个挂环） */}
      <path d="M16 8 L16 14" />
      <path d="M32 8 L32 14" />
      {/* 空日期格点（3×2 淡点表示空白） */}
      <circle cx="16" cy="27" r="0.75" fill="currentColor" stroke="none" opacity={0.3} />
      <circle cx="24" cy="27" r="0.75" fill="currentColor" stroke="none" opacity={0.3} />
      <circle cx="32" cy="27" r="0.75" fill="currentColor" stroke="none" opacity={0.3} />
      <circle cx="16" cy="34" r="0.75" fill="currentColor" stroke="none" opacity={0.3} />
      <circle cx="24" cy="34" r="0.75" fill="currentColor" stroke="none" opacity={0.3} />
      <circle cx="32" cy="34" r="0.75" fill="currentColor" stroke="none" opacity={0.3} />
    </svg>
  );
}

/** 用户：多人轮廓（表示暂无成员/用户）。 */
function UsersIllustration() {
  return (
    <svg {...svgProps} role="img" aria-label="No users">
      {/* 前面的人（较大） */}
      <circle cx="18" cy="18" r="6" />
      <path d="M8 38 Q8 28 18 28 Q28 28 28 38" />
      {/* 后面的人（较小，偏右上） */}
      <circle cx="33" cy="16" r="4.5" opacity={0.6} />
      <path d="M26 36 Q26 28 33 28 Q40 28 40 36" opacity={0.6} />
    </svg>
  );
}

const ILLUSTRATIONS: Record<EmptyStateType, () => ReactNode> = {
  inbox: InboxIllustration,
  folder: FolderIllustration,
  search: SearchIllustration,
  chart: ChartIllustration,
  calendar: CalendarIllustration,
  users: UsersIllustration,
};

export type { EmptyStateType, EmptyStateProps };

export default function EmptyState({
  type,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const Illustration = ILLUSTRATIONS[type];
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-[var(--space-4)] py-12 ${
        className ?? ""
      }`}
    >
      <div className="text-[var(--meta)] mb-[var(--space-4)]">
        <Illustration />
      </div>
      <p className="text-[length:var(--text-base)] font-[weight:var(--weight-medium)] text-[var(--fg)]">
        {title}
      </p>
      {description && (
        <p className="mt-1 text-[length:var(--text-sm)] text-[var(--meta)]">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-[var(--space-5)] inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}