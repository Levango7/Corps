/**
 * Skeleton · 占位加载组件
 *
 * 设计参考 Linear / Stripe：用与最终内容尺寸一致的占位块替代 spinner，
 * 避免加载完成时布局跳动。采用 shimmer 渐变扫光（高光从左到右扫过），
 * 比透明度脉动（animate-pulse）更具加载质感。
 * 所有色值走 var(--token)（shimmer 渐变由 --shimmer-* token 派生），圆角用 var(--radius-sm)。
 *
 * 导出预设：
 *  - Skeleton             基础块，可由调用方拼装任意形状
 *  - TaskListSkeleton     最近更新列表骨架（图标 + 标题 + 日期 + 头像）
 *  - StatCardSkeleton     概览页三张统计卡片骨架
 *  - DocumentListSkeleton 文档列表骨架（图标 + 标题 + 日期 + 状态标签）
 *  - BoardColumnSkeleton  看板列骨架（列头 + 卡片列表）
 *  - TaskDetailSkeleton   任务详情骨架（标题 + 属性 + 描述 + 评论）
 *  - CircleSkeleton       通用圆形骨架（头像/图标位）
 */

import type { CSSProperties } from "react";

/** 基础 Skeleton 块：shimmer 扫光渐变 + radius-sm 圆角 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div style={style} className={`shimmer rounded-[var(--radius-sm)] ${className ?? ""}`} />;
}

/**
 * 任务列表 Skeleton
 * 渲染 count 行骨架，每行与 page.tsx 最近更新列表实际尺寸对齐：
 *   状态图标 15px + 标题占位 + 优先级 13px + 日期 xs + 头像 24px
 * 调用方可通过 className 覆盖外层容器样式。
 */
export function TaskListSkeleton({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={`divide-y divide-[var(--border-soft)] ${className ?? ""}`} aria-busy="true">
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
      className={`grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6 ${className ?? ""}`}
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
/**
 * 文档列表 Skeleton
 * 渲染 count 行骨架，每行与 DocumentListView.tsx 文档项尺寸对齐：
 *   FileText 图标 15px + 标题占位（flex-1）+ 状态标签占位 + 日期占位
 * 第二行：作者 + 更新日期（text-xs, muted）
 * 容器与正式列表一致：divide-y, rounded-md, border, bg-surface
 */
export function DocumentListSkeleton({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <ul
      className={`divide-y divide-[var(--border-soft)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] ${className ?? ""}`}
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="px-[var(--space-4)] py-3 pl-[var(--space-8)]">
          {/* 第一行：图标 + 标题 + 状态标签 */}
          <div className="flex items-center gap-2">
            {/* FileText 图标占位 15px */}
            <Skeleton className="shrink-0 w-[15px] h-[15px]" />
            {/* 标题占位：宽度在 60%~95% 间错落 */}
            <Skeleton
              className="flex-1 h-[14px]"
              style={{ maxWidth: `${60 + ((i * 37) % 36)}%` }}
            />
            {/* 状态标签占位 */}
            <Skeleton className="shrink-0 w-12 h-[12px] rounded-full" />
          </div>
          {/* 第二行：作者 + 日期（ml-6 对齐图标宽度 + gap） */}
          <div className="mt-1 ml-6 flex items-center gap-2">
            <Skeleton className="shrink-0 w-10 h-[10px]" />
            <Skeleton className="shrink-0 w-16 h-[10px]" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * 看板列 Skeleton
 * 模拟 BoardView.tsx 看板列结构：
 *   列头：色点 8px + 标题占位 + 计数占位
 *   卡片项：count 个卡片骨架（拖拽手柄 + 标题 + 副字段）
 * 容器与正式列一致：bg-surface-2, rounded-lg, p-3, min-w-board-col-min-w
 */
export function BoardColumnSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`bg-[var(--surface-2)] rounded-[var(--radius-lg)] p-3 min-w-[var(--board-col-min-w)] flex-shrink-0 ${className ?? ""}`}
      aria-busy="true"
    >
      {/* 列头：色点 + 标题 + 计数 */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[var(--border)]">
        {/* 色点占位 8px */}
        <Skeleton className="w-2 h-2 rounded-full shrink-0" />
        {/* 标题占位 */}
        <Skeleton className="w-20 h-[14px]" />
        {/* 计数占位 */}
        <Skeleton className="ml-auto w-6 h-[12px] rounded-full" />
      </div>

      {/* 卡片列表 */}
      <div className="space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-2.5"
          >
            <div className="flex items-start gap-2">
              {/* GripVertical 手柄占位 14px */}
              <Skeleton className="shrink-0 w-[14px] h-[14px] mt-0.5" />
              <div className="flex-1 min-w-0">
                {/* 标题占位：宽度错落 */}
                <Skeleton className="h-[14px]" style={{ maxWidth: `${60 + ((i * 37) % 36)}%` }} />
                {/* 副字段占位 */}
                <Skeleton className="mt-1 w-16 h-[10px]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 任务详情 Skeleton
 * 模拟 task/[id]/page.tsx 任务详情布局：
 *   返回栏占位
 *   标题区：大标题 + 星标按钮 + 描述行（3-4 行错落）
 *   属性栏：状态 + 优先级 + 指派人 + 截止日期
 *   评论区：2 条评论骨架（头像 + 姓名 + 时间 + 内容）
 */
export function TaskDetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={`max-w-[var(--container-max)] mx-auto ${className ?? ""}`} aria-busy="true">
      {/* 返回栏占位 */}
      <div className="mb-[var(--space-5)]">
        <Skeleton className="h-8 w-24 rounded-[var(--radius-md)]" />
      </div>

      {/* 标题区容器（与 TaskDetailHeader 一致：surface + border + radius-lg + p-5） */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-5)]">
        {/* 标题行：大标题 + 星标按钮 */}
        <div className="flex items-start gap-[var(--space-2)]">
          {/* 大标题占位（text-xl, font-semibold） */}
          <Skeleton className="flex-1 h-8" style={{ maxWidth: "75%" }} />
          {/* 星标按钮占位 */}
          <Skeleton className="shrink-0 w-9 h-9 rounded-[var(--radius-md)]" />
        </div>

        {/* 描述区占位（3-4 行错落宽度） */}
        <div className="mt-[var(--space-3)] space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4" style={{ maxWidth: "70%" }} />
        </div>
      </div>

      {/* 属性栏占位（与 TaskPropertyAside 一致：surface + border + radius-lg + p-3） */}
      <div className="mt-[var(--space-4)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-3)] grid grid-cols-2 gap-[var(--space-3)]">
        {/* 状态字段 */}
        <div>
          <Skeleton className="h-[12px] w-12 mb-1.5" />
          <Skeleton className="h-8 w-full rounded-[var(--radius-md)]" />
        </div>
        {/* 优先级字段 */}
        <div>
          <Skeleton className="h-[12px] w-10 mb-1.5" />
          <Skeleton className="h-8 w-full rounded-[var(--radius-md)]" />
        </div>
        {/* 指派人字段 */}
        <div>
          <Skeleton className="h-[12px] w-14 mb-1.5" />
          <Skeleton className="h-8 w-full rounded-[var(--radius-md)]" />
        </div>
        {/* 截止日期字段 */}
        <div>
          <Skeleton className="h-[12px] w-16 mb-1.5" />
          <Skeleton className="h-8 w-full rounded-[var(--radius-md)]" />
        </div>
      </div>

      {/* 评论区占位（与 TaskComments 一致：mt-8） */}
      <div className="mt-[var(--space-8)]">
        {/* 评论标题占位 */}
        <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-3)]">
          <Skeleton className="w-4 h-4 rounded-full" />
          <Skeleton className="w-20 h-[16px]" />
        </div>

        {/* 2 条评论骨架 */}
        <div className="divide-y divide-[var(--border-soft)]">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex gap-[var(--space-3)] px-[var(--space-2)] py-1.5">
              {/* 头像占位（w-7 h-7 sm:w-8 sm:h-8） */}
              <Skeleton className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                {/* 姓名 + 时间行 */}
                <div className="flex items-baseline gap-[var(--space-2)]">
                  <Skeleton className="w-16 h-[14px]" />
                  <Skeleton className="w-10 h-[10px]" />
                </div>
                {/* 评论内容占位（2 行错落） */}
                <Skeleton
                  className="mt-0.5 h-[14px]"
                  style={{ maxWidth: `${60 + ((i * 37) % 36)}%` }}
                />
                <Skeleton className="mt-1 h-[14px]" style={{ maxWidth: "85%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 通用圆形 Skeleton（头像/图标位）
 * 使用 shimmer + rounded-full，尺寸由 size 参数控制。
 */
export function CircleSkeleton({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <Skeleton className={`rounded-full ${className ?? ""}`} style={{ width: size, height: size }} />
  );
}
