"use client";

/**
 * useSwipeDismiss — 左滑消除 hook。
 *
 * 用 framer-motion drag="x" + dragConstraints 实现弹性拖拽。
 * 滑动超过阈值（100px）或速度超过 500px/s 时触发 onDismiss。
 * 尊重 prefers-reduced-motion：reduced 时禁用拖拽动画。
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §4.3 swipe-to-dismiss
 */

import { useReducedMotion } from "framer-motion";
import { useCallback } from "react";

export interface UseSwipeDismissOptions {
  /** 滑动阈值，默认 100px */
  threshold?: number;
  /** 速度阈值，默认 500px/s */
  velocityThreshold?: number;
  /** 消除回调 */
  onDismiss: () => void;
}

export interface UseSwipeDismissResult {
  /** framer-motion drag 配置 */
  drag: "x" | false;
  /** drag 约束 */
  dragConstraints: { left: number; right: number };
  /** 弹性系数 */
  dragElastic: number;
  /** 拖拽结束处理器 */
  onDragEnd: (
    _: unknown,
    info: { offset: { x: number; y: number }; velocity: { x: number; y: number } },
  ) => void;
  /** 拖拽时的视觉反馈 */
  whileDrag: { scale: number };
}

export function useSwipeDismiss({
  threshold = 100,
  velocityThreshold = 500,
  onDismiss,
}: UseSwipeDismissOptions): UseSwipeDismissResult {
  const prefersReduced = useReducedMotion();

  const onDragEnd = useCallback(
    (
      _: unknown,
      info: { offset: { x: number; y: number }; velocity: { x: number; y: number } },
    ) => {
      if (
        info.offset.x > threshold ||
        info.velocity.x > velocityThreshold
      ) {
        onDismiss();
      }
    },
    [threshold, velocityThreshold, onDismiss],
  );

  return {
    drag: prefersReduced ? false : "x",
    dragConstraints: { left: 0, right: 0 },
    dragElastic: 0.7,
    onDragEnd,
    whileDrag: { scale: 0.98 },
  };
}
