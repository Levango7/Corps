/**
 * 工作区路由段加载骨架 · app/[locale]/w/[wid]/loading.tsx
 *
 * Next.js App Router 在子段 suspense 时自动渲染最近的 loading.tsx，
 * 替换正在加载的路由段，保留父 layout（顶栏/侧栏不丢失）。
 *
 * 纯展示组件：
 *  - 不需要 "use client"
 *  - 不需要 i18n（骨架屏无文本）
 *  - 复用 page.tsx 的容器结构（max-w-5xl mx-auto）与设计 tokens
 *
 * 布局与工作区首页 page.tsx 对齐：
 *  1. 顶部标题行（标题 + 副标题 + 新建按钮占位）
 *  2. 统计卡片骨架（StatCardSkeleton，3 列网格）
 *  3. "最近更新"列表区（section + header + TaskListSkeleton）
 */

import { Skeleton, StatCardSkeleton, TaskListSkeleton } from "@/components/Skeleton";

export default function WorkspaceLoading() {
  return (
    <div className="max-w-5xl mx-auto">
      {/* ─── 顶部标题行：与 page.tsx 顶部对齐，避免加载完成时布局跳动 ─── */}
      <div className="flex items-end justify-between mb-[var(--space-6)] gap-[var(--space-4)]">
        <div>
          {/* 标题占位 */}
          <Skeleton className="w-28 h-[28px]" />
          {/* 副标题占位 */}
          <Skeleton className="mt-1.5 w-52 h-[14px]" />
        </div>
        {/* 新建按钮占位 */}
        <Skeleton className="shrink-0 w-24 h-9 rounded-[var(--radius-md)]" />
      </div>

      {/* ─── 统计卡片骨架：3 列网格，与 page.tsx 统计卡片区对齐 ─── */}
      <StatCardSkeleton />

      {/* ─── "最近更新"列表区骨架 ─── */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)]">
        <header className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[var(--border-soft)]">
          {/* 列表标题占位 */}
          <Skeleton className="w-20 h-[16px]" />
          {/* 排序下拉 + 查看全部占位 */}
          <div className="flex items-center gap-[var(--space-3)]">
            <Skeleton className="w-24 h-7 rounded-[var(--radius-md)]" />
            <Skeleton className="w-16 h-[14px]" />
          </div>
        </header>
        <TaskListSkeleton count={5} />
      </section>
    </div>
  );
}
