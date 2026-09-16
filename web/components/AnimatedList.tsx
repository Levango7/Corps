"use client";

/**
 * AnimatedList / AnimatedItem — 可复用的列表 stagger 进场动画组件。
 *
 * 用法：<AnimatedList> 包裹列表容器，每个列表项用 <AnimatedItem> 包裹。
 * 容器通过 staggerChildren 让子项依次 fadeUp（opacity 0→1, y 8→0）进场。
 *
 * 无障碍：尊重 prefers-reduced-motion，降级时仅 opacity 过渡、无位移，
 * stagger 退化为同时显现（容器不编排 delayChildren）。
 *
 * 时长 / 缓动走 motion-tokens 常量（与 design-tokens.css :root 同步），
 * 避免在 JS 侧硬编码与 CSS var 漂移。
 *
 * 经验来源：
 *  - 2026-09-13-framer-motion-userreducedmotion-component-level-reduction
 *    （组件级 useReducedMotion 降级模式：降级时条件展开 transform 属性）
 *  - 2026-09-13-framer-motion-css-var-to-js-constant-bridge
 *    （CSS var → JS 常量桥接，用 MOTION 常量保持与 design-tokens.css 同步）
 */

import { type ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { MOTION } from "@/lib/motion-tokens";

interface AnimatedListProps {
  children: ReactNode;
  className?: string;
  /** stagger 间隔（秒），默认 0.05s */
  delay?: number;
}

interface AnimatedItemProps {
  children: ReactNode;
  className?: string;
}

/**
 * 列表容器：motion.div + staggerChildren 编排子项进场。
 *
 * 容器自身无视觉变化（hidden/visible 仅承载 transition.staggerChildren），
 * 子项通过 variants 名匹配继承 initial="hidden" / animate="visible"。
 *
 * 降级时容器不编排 stagger（hidden/visible 均为空对象），
 * 子项各自独立 fade，同时显现。
 */
export function AnimatedList({ children, className, delay = 0.05 }: AnimatedListProps) {
  const reduceMotion = useReducedMotion();

  const containerVariants: Variants = reduceMotion
    ? { hidden: {}, visible: {} }
    : {
        hidden: {},
        visible: {
          transition: {
            staggerChildren: delay,
            delayChildren: 0,
          },
        },
      };

  return (
    <motion.div
      className={className}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}

/**
 * 列表子项：motion.div + fadeUp 变体（opacity 0→1, y 8→0）。
 *
 * 通过 variants 继承父级 AnimatedList 的 initial/animate 状态名，
 * 由父级 staggerChildren 控制依次进场时机。
 *
 * 降级时仅 opacity 过渡（duration = var(--motion-base) 150ms），无位移。
 */
export function AnimatedItem({ children, className }: AnimatedItemProps) {
  const reduceMotion = useReducedMotion();

  // 降级：条件展开，仅保留 opacity，不输出 y/transform（见经验文档组件级降级模式）
  const itemVariants: Variants = reduceMotion
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: MOTION.base } },
      }
    : {
        hidden: { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          // var(--motion-slow) 220ms + var(--ease-out) 减速进场
          transition: { duration: MOTION.slow, ease: MOTION.easeOut },
        },
      };

  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}