"use client";

/**
 * Parallax — 滚动视差包裹组件。
 *
 * 用 framer-motion useScroll + useTransform 实现滚动视差。
 * 向上滚动时元素以稍慢速度移动，产生深度感。
 * 尊重 prefers-reduced-motion：reduced 时直接渲染 children，无视差。
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §4.4 页面视差
 */

import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";
import { type ReactNode, useRef } from "react";

export interface ParallaxProps {
  children: ReactNode;
  /** 视差偏移量（px），默认 50。应用内建议 ≤ 10，营销页可加大 */
  offset?: number;
  /** 滚动范围起点，默认 0 */
  scrollStart?: number;
  /** 滚动范围终点，默认 300 */
  scrollEnd?: number;
  className?: string;
}

export function Parallax({
  children,
  offset = 50,
  scrollStart = 0,
  scrollEnd = 300,
  className,
}: ParallaxProps) {
  const prefersReduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [scrollStart, scrollEnd], [0, -offset]);

  // prefers-reduced-motion：直接渲染 children，无视差
  if (prefersReduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div ref={ref} style={{ y }} className={className}>
      {children}
    </motion.div>
  );
}