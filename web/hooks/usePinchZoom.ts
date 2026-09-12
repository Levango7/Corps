"use client";

/**
 * usePinchZoom — 双指捏合缩放 hook。
 *
 * 用 framer-motion useMotionValue 跟踪双指距离，计算缩放比。
 * 缩放范围 0.5~3x，双击复位到 1x。
 * 尊重 prefers-reduced-motion：reduced 时直接设 scale 无动画。
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §4.3 pinch-to-zoom
 */

import { useMotionValue, useReducedMotion } from "framer-motion";
import { useCallback, useRef, useState } from "react";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const DOUBLE_TAP_DELAY = 300;

export interface UsePinchZoomResult {
  /** 当前缩放值（MotionValue，可直接传给 motion.div style={{ scale }}） */
  scale: ReturnType<typeof useMotionValue<number>>;
  /** 展开到目标元素的触摸事件绑定 */
  bind: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onDoubleClick: () => void;
  };
}

export function usePinchZoom(): UsePinchZoomResult {
  const scale = useMotionValue(1);
  const prefersReduced = useReducedMotion();
  const initialDistanceRef = useRef<number | null>(null);
  const lastTapRef = useRef<number>(0);

  const getDistance = (touches: React.TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const clampScale = (value: number): number =>
    Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        initialDistanceRef.current = getDistance(e.touches);
      }
    },
    [],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2 && initialDistanceRef.current) {
        const currentDistance = getDistance(e.touches);
        const ratio = currentDistance / initialDistanceRef.current;
        const newScale = clampScale(ratio);
        scale.set(prefersReduced ? Math.round(newScale) : newScale);
      }
    },
    [scale, prefersReduced],
  );

  const onTouchEnd = useCallback(() => {
    initialDistanceRef.current = null;
  }, []);

  // 双击复位
  const onDoubleClick = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      scale.set(1);
    }
    lastTapRef.current = now;
  }, [scale]);

  return {
    scale,
    bind: { onTouchStart, onTouchMove, onTouchEnd, onDoubleClick },
  };
}