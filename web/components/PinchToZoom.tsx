"use client";

/**
 * PinchToZoom — 双指缩放手势组件。
 *
 * 设计依据：design/FEATURE-DESIGN-ui-polish.md §4.3。
 *
 * 交互：
 *  - onTouchStart 记录双指初始距离 d0
 *  - onTouchMove 计算当前距离 d，scale = clamp(d / d0 * prevScale, minScale, maxScale)
 *  - 双指捏合缩小、张开放大
 *  - scale 范围限制 [minScale, maxScale]（默认 [0.5, 2]）
 *  - 单指触摸时不干预（不影响内部滚动等交互）
 *  - 尊重 prefers-reduced-motion：降级为无缩放，直接渲染 children
 *
 * 实现说明：
 *  - 使用原生 TouchEvent 而非 framer-motion 的 drag/pinch（后者对双指支持有限）
 *  - scale 通过 useMotionValue 驱动 motion.div style={{ scale }}
 *  - 双指离开后保留当前 scale（不回弹），单指操作时 scale 不变
 *
 * 经验来源：
 *  - 2026-09-13-framer-motion-css-var-to-js-constant-bridge（useMotionValue 用法）
 */

import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion } from "framer-motion";

export interface PinchToZoomProps {
  children: ReactNode;
  /** 最小缩放比例，默认 0.5 */
  minScale?: number;
  /** 最大缩放比例，默认 2 */
  maxScale?: number;
}

export function PinchToZoom({ children, minScale = 0.5, maxScale = 2 }: PinchToZoomProps) {
  const prefersReduced = useReducedMotion();
  const scale = useMotionValue(1);

  /** 双指初始距离（onTouchStart 时记录） */
  const initialDistanceRef = useRef<number | null>(null);
  /** 缩放起始时的 scale 值（用于增量计算） */
  const startScaleRef = useRef<number>(1);

  /** 计算两触点间距离 */
  function getDistance(touches: React.TouchList): number {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      initialDistanceRef.current = getDistance(e.touches);
      startScaleRef.current = scale.get();
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && initialDistanceRef.current !== null) {
      e.preventDefault(); // 阻止页面滚动
      const currentDistance = getDistance(e.touches);
      if (currentDistance > 0 && initialDistanceRef.current > 0) {
        const ratio = currentDistance / initialDistanceRef.current;
        const nextScale = Math.min(Math.max(startScaleRef.current * ratio, minScale), maxScale);
        scale.set(nextScale);
      }
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) {
      initialDistanceRef.current = null;
    }
  }

  // 降级模式：无缩放，直接渲染
  if (prefersReduced) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <motion.div
      style={{ scale }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="h-full w-full touch-pan-x touch-pan-y"
    >
      {children}
    </motion.div>
  );
}
