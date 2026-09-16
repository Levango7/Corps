"use client";

/**
 * VirtualList — 基于 @tanstack/react-virtual 的可复用虚拟列表组件。
 *
 * 适用场景：长列表（数百至数万条）只渲染可视区域 + overscan 预渲染，
 * 避免一次性 mount 大量 DOM 节点造成卡顿。
 *
 * 设计：
 *  - 外层 div 作为滚动容器（overflow:auto + contain:strict 提升滚动性能）
 *  - 内层 div 撑起总高度（position:relative），子项用 absolute + translateY 定位
 *  - 滚动条样式走 design token（--surface-3 / --meta），不硬编码颜色
 *  - 泛型 T 透传到 renderItem，保留完整类型推断
 *
 * 用法：
 *   <VirtualList
 *     items={tasks}
 *     renderItem={(task) => <TaskCard task={task} />}
 *     estimateSize={56}
 *   />
 *
 * 注意：
 *  - renderItem 返回的节点高度应尽量接近 estimateSize，避免滚动时跳动；
 *    若节点高度差异大，可改用 measureElement 实测（本组件暂未暴露该选项，
 *    如有需求可后续扩展）。
 *  - 列表项 key 由 virtualItem.key 提供（基于 index，稳定可靠）。
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type ReactNode } from "react";

interface VirtualListProps<T> {
  /** 列表数据 */
  items: T[];
  /** 渲染单项的函数，接收 item 与 index */
  renderItem: (item: T, index: number) => ReactNode;
  /** 每项预估高度（px），默认 56 */
  estimateSize?: number;
  /** 附加到滚动容器的外层 className */
  className?: string;
  /** 预渲染数量（可视区外上下各 overscan 项），默认 5 */
  overscan?: number;
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateSize = 56,
  className,
  overscan = 5,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  return (
    <div
      ref={parentRef}
      className={className}
      style={{
        overflow: "auto",
        // contain:strict 让浏览器跳过子元素布局/绘制对滚动容器外的影响，
        // 显著提升长列表滚动性能（与 react-virtual 官方推荐一致）
        contain: "strict",
        // 滚动条走 design token，避免硬编码颜色（亮/暗主题自动适配）
        scrollbarColor: "var(--surface-3) var(--surface)",
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              // 用 transform 而非 top 定位，触发 GPU 合成层，滚动更流畅
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}