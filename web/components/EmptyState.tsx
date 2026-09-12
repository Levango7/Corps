"use client";

/**
 * EmptyState · 通用空状态组件
 *
 * 提供 10 种内联 SVG 插画（inbox / folder / search / chart / calendar / users
 * / network / permission / trash / filter），用于各列表/面板无数据时的占位引导。
 * 所有色值走 var(--token)，SVG 用 currentColor 继承文字颜色，保持暗色模式与主题切换一致。
 *
 * 设计规范：
 *  - 居中布局（flex column items-center justify-center）
 *  - SVG 尺寸默认 64px（可选 48 / 80），颜色 text-[var(--meta)]
 *  - 标题 text-[var(--fg)] + font-[var(--weight-medium)] + text-base
 *  - 描述 text-[var(--meta)] + text-sm
 *  - 可选操作按钮复用项目现有 accent 按钮样式
 *  - 整体 py-12 垂直间距，支持 className 覆盖
 *
 * 动画（§3.1 空状态设计）：
 *  - 入场 stagger：插画 → 标题 → 描述 → CTA 依次淡入（staggerChildren 0.06s）
 *  - 插画微动效：挂载 2s 后主元素轻微浮动（y: 0 → -2px → 0，2s 循环）
 *  - prefers-reduced-motion / F6 [data-motion="reduced"] 档下自动停止（via useMotionTokens）
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §3.1
 */

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useMotionTokens } from "@/lib/motion-tokens";

type EmptyStateType =
  | "inbox"
  | "folder"
  | "search"
  | "chart"
  | "calendar"
  | "users"
  | "network"
  | "permission"
  | "trash"
  | "filter";

interface EmptyStateProps {
  type: EmptyStateType;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  /** 是否启用入场 stagger 动画（默认 true） */
  animate?: boolean;
  /** 插画尺寸（默认 64，可选 48 / 80） */
  illustrationSize?: 48 | 64 | 80;
}

/** SVG 基础属性：48×48 viewBox，线条风格，currentColor 继承文字颜色。 */
const baseSvgProps = {
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** 按尺寸生成完整 SVG 属性（width / height 随 illustrationSize 变化）。 */
function svgProps(size: number) {
  return { ...baseSvgProps, width: size, height: size };
}

/** 收件箱：空盒子 + 上箭头（表示收件箱为空，可放入内容）。 */
function InboxIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="Empty inbox">
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
function FolderIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="Empty folder">
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
function SearchIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="No search results">
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
function ChartIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="No chart data">
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
function CalendarIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="Empty calendar">
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
function UsersIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="No users">
      {/* 前面的人（较大） */}
      <circle cx="18" cy="18" r="6" />
      <path d="M8 38 Q8 28 18 28 Q28 28 28 38" />
      {/* 后面的人（较小，偏右上） */}
      <circle cx="33" cy="16" r="4.5" opacity={0.6} />
      <path d="M26 36 Q26 28 33 28 Q40 28 40 36" opacity={0.6} />
    </svg>
  );
}

/** 网络：云 + 离线斜杠（表示网络连接中断）。 */
function NetworkIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="Network offline">
      {/* 云主体 */}
      <path d="M16 30 C12 30 10 28 10 25 C10 22 13 20 16 20 C17 16 21 14 25 14 C30 14 33 17 33 21 C37 21 39 23 39 26 C39 29 37 30 34 30 Z" />
      {/* 离线斜杠 */}
      <path d="M14 14 L34 34" />
    </svg>
  );
}

/** 权限：锁 + 禁止符号（表示无访问权限）。 */
function PermissionIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="No permission">
      {/* 锁环 */}
      <path d="M18 22 L18 16 Q18 11 24 11 Q30 11 30 16 L30 22" />
      {/* 锁身 */}
      <rect x="13" y="22" width="22" height="16" rx="2" />
      {/* 禁止圆 */}
      <circle cx="24" cy="30" r="4" />
      {/* 禁止斜杠 */}
      <path d="M21.2 27.2 L26.8 32.8" />
    </svg>
  );
}

/** 回收站：空垃圾桶（表示回收站为空）。 */
function TrashIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="Empty trash">
      {/* 桶盖把手 */}
      <path d="M20 10 L28 10" />
      {/* 桶盖 */}
      <path d="M14 14 L34 14" />
      {/* 桶身（梯形） */}
      <path d="M16 14 L18 40 L30 40 L32 14" />
      {/* 桶内空提示线 */}
      <path d="M22 24 L26 24" opacity={0.4} />
    </svg>
  );
}

/** 筛选：漏斗 + 无匹配斜杠（表示筛选无结果）。 */
function FilterIllustration({ size }: { size: number }) {
  return (
    <svg {...svgProps(size)} role="img" aria-label="No filter results">
      {/* 漏斗 */}
      <path d="M10 14 L38 14 L26 28 L26 38 L22 38 L22 28 Z" />
      {/* 无匹配斜杠 */}
      <path d="M12 12 L36 36" opacity={0.5} />
    </svg>
  );
}

const ILLUSTRATIONS: Record<EmptyStateType, (props: { size: number }) => ReactNode> = {
  inbox: InboxIllustration,
  folder: FolderIllustration,
  search: SearchIllustration,
  chart: ChartIllustration,
  calendar: CalendarIllustration,
  users: UsersIllustration,
  network: NetworkIllustration,
  permission: PermissionIllustration,
  trash: TrashIllustration,
  filter: FilterIllustration,
};

export type { EmptyStateType, EmptyStateProps };

/** stagger 容器 variants：子元素依次淡入。 */
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

/** stagger 子元素 variants：淡入 + 微 slide-up（y: 8 → 0）。 */
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

export default function EmptyState({
  type,
  title,
  description,
  action,
  className,
  animate = true,
  illustrationSize = 64,
}: EmptyStateProps) {
  const { reduced } = useMotionTokens();
  const shouldAnimate = animate && !reduced;
  const Illustration = ILLUSTRATIONS[type];

  return (
    <motion.div
      initial={shouldAnimate ? "hidden" : false}
      animate="visible"
      variants={containerVariants}
      className={`flex flex-col items-center justify-center text-center px-[var(--space-4)] py-[var(--space-12)] ${
        className ?? ""
      }`}
    >
      <motion.div variants={itemVariants} className="text-[var(--meta)] mb-[var(--space-4)]">
        <motion.div
          animate={shouldAnimate ? { y: [0, -2, 0] } : undefined}
          transition={
            shouldAnimate
              ? { duration: 2, repeat: Infinity, ease: "easeInOut", delay: 2 }
              : undefined
          }
        >
          <Illustration size={illustrationSize} />
        </motion.div>
      </motion.div>
      <motion.p
        variants={itemVariants}
        className="text-[length:var(--text-base)] font-[weight:var(--weight-medium)] text-[var(--fg)]"
      >
        {title}
      </motion.p>
      {description && (
        <motion.p
          variants={itemVariants}
          className="mt-1 text-[length:var(--text-sm)] text-[var(--meta)]"
        >
          {description}
        </motion.p>
      )}
      {action && (
        <motion.div variants={itemVariants}>
          <button
            type="button"
            onClick={action.onClick}
            className="mt-[var(--space-5)] inline-flex items-center gap-2 px-[var(--space-4)] py-[var(--space-2)] bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[weight:var(--weight-medium)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            {action.label}
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
