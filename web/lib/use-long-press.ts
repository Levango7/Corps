"use client";

/**
 * useLongPress — 长按手势 hook，500ms 触发回调并传递坐标。
 *
 * 设计参考：design/FEATURE-DESIGN-ui-polish.md §4.1 长按浮窗菜单
 *
 * 工作机制：
 *  - onPointerDown 启动 setTimeout 计时器，记录触发坐标
 *  - onPointerUp / onPointerLeave / onPointerCancel 清除计时器（松手或移开取消）
 *  - 计时器到期后调用 callback，传入 { x, y } 坐标供 QuickActionMenu 定位
 *  - onContextMenu 阻止默认右键菜单并直接触发回调（移动端长按等效行为）
 *
 * 返回的事件处理器可直接展开到 motion.div / div 的 props 上。
 */

import { useCallback, useRef } from "react";

export interface LongPressPosition {
  x: number;
  y: number;
}

export interface UseLongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function useLongPress(
  callback: (pos: LongPressPosition) => void,
  delay = 500,
): UseLongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionRef = useRef<LongPressPosition>({ x: 0, y: 0 });

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(
    (e: React.PointerEvent) => {
      positionRef.current = { x: e.clientX, y: e.clientY };
      clear();
      timerRef.current = setTimeout(() => {
        callback(positionRef.current);
      }, delay);
    },
    [callback, delay, clear],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      callback({ x: e.clientX, y: e.clientY });
    },
    [callback],
  );

  return {
    onPointerDown: start,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu,
  };
}