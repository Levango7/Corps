/**
 * Skeleton · 占位加载组件
 *
 * 设计参考 Linear：用与最终内容尺寸一致的灰色占位块替代 spinner，
 * 避免加载完成时布局跳动。所有色值走 var(--token)，圆角用 var(--radius-sm)。
 *
 * 导出预设：
 *  - Skeleton          基础块，可由调用方拼装任意形状
 *  - TaskListSkeleton  最近更新列表骨架（图标 + 标题 + 日期 + 头像）
 *  - StatCardSkeleton  概览页三张统计卡片骨架
 */

import type { CSSProperties } from "react";

/** 基础 Skeleton 块：animate-pulse + surface-2 背景 + radius-sm 圆角 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`animate-pulse bg-[var(--surface-2)] rounded-[var(--radius-sm)] ${
        className ?? ""
      }`}
    />
  );
}

/**
 * 任务列表 Skeleton
 * 渲染 count 行骨架，每行与 page.tsx 最近更新列表实际尺寸对齐：
 *   状态图标 15px + 标题占位 + 优先级 13px + 日期 xs + 头像 24px
 * 调用方可通过 className 覆盖外层容器样式。
 */
export function TaskListSkeleton({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`divide-y divide-[var(--border-soft)] ${className ?? ""}`}
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 sm:px-5 py-3">
          {/* 状态图标占位 */}
          <Skeleton className="shrink-0 w-[15px] h-[15px] rounded-full" />
          {/* 标题占位：宽度在 60%~95% 间错落，避免机械感 */}
          <Skeleton
            className="flex-1 h-[14px]"
            // 通过 inline style 控制宽度比例，避免动态 class 名被 Tailwind purge
            style={{ maxWidth: `${60 + ((i * 37) % 36)}%` }}
          />
          {/* 优先级图标占位（< sm 隐藏，与正式列表一致） */}
          <Skeleton className="hidden sm:block shrink-0 w-[13px] h-[13px] rounded-full" />
          {/* 日期占位 */}
          <Skeleton className="shrink-0 w-12 h-[12px]" />
          {/* 头像占位（< sm 隐藏，与正式列表一致） */}
          <Skeleton className="hidden sm:block shrink-0 w-6 h-6 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * 统计卡片 Skeleton
 * 渲染 3 张与概览页统计卡片尺寸一致的骨架：
 *   p-5 容器 + 顶部状态行（图标 16 + 标签 sm）+ 大数字 text-3xl
 * 响应式与正式卡片保持一致：grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4
 */
export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 ${
        className ?? ""
      }`}
      aria-busy="true"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-5"
        >
          {/* 顶部状态行：图标 + 标签 */}
          <div className="flex items-center gap-2">
            <Skeleton className="w-4 h-4 rounded-full" />
            <Skeleton className="w-10 h-[13px]" />
          </div>
          {/* 大数字占位 */}
          <Skeleton className="mt-2 w-16 h-[28px]" />
        </div>
      ))}
    </div>
  );
}
