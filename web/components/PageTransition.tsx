"use client";

/**
 * PageTransition — App Router 页面切换过渡包裹组件。
 *
 * 用 framer-motion `AnimatePresence` + `motion.div`，以 `usePathname()` 为 key，
 * 路由切换时旧页面 exit → 新页面 enter，实现丝滑过渡而非生硬跳转。
 *
 * - 支持三种模式：fade（纯淡入）/ slide（淡入 + 微 slide-up，默认）/ scale（淡入 + 微缩放）
 * - `AnimatePresence initial={false}`：首屏直接显示 animate 状态（无入场动画，避免白屏），
 *   仅后续路由切换播放 exit/enter（见设计文档 §2.1 性能考量）
 * - 尊重 prefers-reduced-motion 与 F6 [data-motion="reduced"]：reduced 时纯 opacity 瞬切
 * - 所有时长 / 缓动走 design token（var(--motion-slow) / var(--ease-standard)）
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §2.1 页面切换动画
 */

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  useMotionTokens,
  fadeVariants,
  slideVariants,
  scaleVariants,
} from "@/lib/motion-tokens";

export type PageTransitionMode = "fade" | "slide" | "scale";

export function PageTransition({
  children,
  mode = "slide",
}: {
  children: ReactNode;
  /** 切换动画模式，默认 "slide"（fade + 微 slide-up y:8→0） */
  mode?: PageTransitionMode;
}) {
  const pathname = usePathname();
  const { slow, easeStandard, reduced } = useMotionTokens();

  // reduced：纯 opacity 瞬切，无 transform 位移（避免运动敏感用户不适）
  // 否则按 mode 选 variants
  const variants = reduced
    ? fadeVariants
    : mode === "fade"
      ? fadeVariants
      : mode === "scale"
        ? scaleVariants
        : slideVariants;

  // var(--motion-slow) 220ms + var(--ease-standard)；reduced 时 duration 0
  const transition = reduced
    ? { duration: 0 }
    : { duration: slow, ease: easeStandard };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={variants}
        transition={transition}
        // 仅动画 transform / opacity，不触发 layout / paint（设计原则 §1.1 第 4 条）
        style={{ willChange: "transform, opacity" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}