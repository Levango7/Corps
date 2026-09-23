"use client";

/**
 * SwipeToDismiss — 横滑删除手势组件。
 *
 * 设计依据：design/FEATURE-DESIGN-ui-polish.md §4.3。
 *
 * 交互：
 *  - framer-motion drag="x"，松手回弹（dragConstraints left:0, right:0）
 *  - 横滑超过 threshold（默认 100px）或速度 > velocityThreshold（默认 500px/s）→ 触发 onDismiss
 *  - swipe 过程中背景渐显红色"删除"提示文字
 *  - whileDrag 轻微缩放（scale 0.98）提供物理反馈
 *  - 尊重 prefers-reduced-motion：降级为无 drag，仅保留点击删除按钮
 *
 * 经验来源：
 *  - 2026-09-13-framer-motion-css-var-to-js-constant-bridge（MOTION 常量桥接）
 *  - 2026-09-13-framer-motion-userreducedmotion-component-level-reduction（组件级降级）
 */

import { type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import { Trash2 } from "lucide-react";
import { MOTION } from "@/lib/motion-tokens";

export interface SwipeToDismissProps {
  children: ReactNode;
  onDismiss: () => void;
  /** 横滑位移阈值（px），默认 100 */
  threshold?: number;
  /** 横滑速度阈值（px/s），默认 500 */
  velocityThreshold?: number;
}

export function SwipeToDismiss({
  children,
  onDismiss,
  threshold = 100,
  velocityThreshold = 500,
}: SwipeToDismissProps) {
  const prefersReduced = useReducedMotion();
  const x = useMotionValue(0);

  /** 删除提示透明度：x 偏移越大越显（0→threshold 映射 0→1） */
  const deleteHintOpacity = useTransform(x, [0, threshold], [0, 1]);
  /** 删除提示图标缩放：随偏移微放大 */
  const deleteHintScale = useTransform(x, [0, threshold], [0.6, 1]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
      onDismiss();
    }
  };

  // 降级模式：不启用 drag，仅渲染内容 + 可点击的删除按钮
  if (prefersReduced) {
    return (
      <div className="relative flex items-center">
        <div className="flex-1">{children}</div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 ml-2 p-2 rounded-[var(--radius-sm)] text-[var(--danger)] hover:bg-[var(--danger-soft)] transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          aria-label="delete"
        >
          <Trash2 size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      {/* 背景删除提示 — 滑动时渐显 */}
      <motion.div
        style={{ opacity: deleteHintOpacity }}
        className="absolute inset-0 flex items-center justify-end pr-4 bg-[var(--danger-soft)] rounded-[var(--radius-lg)]"
        aria-hidden="true"
      >
        <motion.div
          style={{ scale: deleteHintScale }}
          className="flex items-center gap-1.5 text-[var(--danger)]"
        >
          <Trash2 size={16} />
          <span className="text-[length:var(--text-sm)] font-[weight:var(--weight-medium)]">
            删除
          </span>
        </motion.div>
      </motion.div>

      {/* 可拖拽内容层 */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={handleDragEnd}
        whileDrag={{ scale: 0.98 }}
        style={{ x }}
        transition={{ duration: MOTION.fast, ease: MOTION.easeStandard }}
        className="relative z-[1]"
      >
        {children}
      </motion.div>
    </div>
  );
}