"use client";

/**
 * useLongPress — 长按手势检测 hook。
 *
 * 检测指针长按（默认 500ms），触发回调。返回 bind 对象可展开到任意元素。
 * 尊重 prefers-reduced-motion：reduced 时阈值降至 0（立即触发）。
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §4.1 长按浮窗菜单
 */

import { useRef, useState, useCallback, useEffect } from "react";

export interface UseLongPressOptions {
  /** 长按阈值，默认 500ms */
  delay?: number;
  /** 长按触发回调 */
  onLongPress: () => void;
  /** 是否禁用 */
  disabled?: boolean;
}

export interface UseLongPressResult {
  /** 展开到目标元素的指针事件绑定 */
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
  };
  /** 是否正在长按中 */
  isLongPressing: boolean;
}

export function useLongPress({
  delay = 500,
  onLongPress,
  disabled = false,
}: UseLongPressOptions): UseLongPressResult {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLongPressing, setIsLongPressing] = useState(false);

  // 检测 prefers-reduced-motion
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }, []);

  const startTimer = useCallback(() => {
    if (disabled) return;
    const effectiveDelay = reduced ? 0 : delay;
    timerRef.current = setTimeout(() => {
      setIsLongPressing(true);
      onLongPress();
    }, effectiveDelay);
  }, [delay, onLongPress, disabled, reduced]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsLongPressing(false);
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    bind: {
      onPointerDown: startTimer,
      onPointerUp: clearTimer,
      onPointerLeave: clearTimer,
      onPointerCancel: clearTimer,
    },
    isLongPressing,
  };
}