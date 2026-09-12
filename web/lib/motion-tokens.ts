"use client";

/**
 * Motion token 桥接：CSS custom properties (var(--motion-*), var(--ease-*)) → JS 常量。
 *
 * 为什么需要桥接：framer-motion 的 `transition.duration` / `ease` 在 JS 侧解析数值，
 * 不能直接引用 CSS `var()`（见设计文档 §5.2）。本模块建立与 design-tokens.css 同步的
 * 常量映射，并提供 `useMotionTokens()` hook 运行时读取 CSS var 以感知 F6 三档动画开关
 * （[data-motion="reduced|standard|enhanced"]）。
 *
 * 同步约束：若 design-tokens.css 中 --motion-* / --ease-* 值变更，需同步更新本文件常量。
 *
 * @see design/FEATURE-DESIGN-ui-polish.md §5.2 token 桥接
 * @see web/app/design-tokens.css L189–194（:root 定义）、L368–384（F6 三档覆盖）
 */

import { useReducedMotion, type Transition, type Variants } from "framer-motion";
import { useEffect, useState } from "react";

// ─── 缓动元组（framer-motion BezierDefinition = [number, number, number, number]）───
const EASE_STANDARD: [number, number, number, number] = [0.2, 0, 0, 1]; // var(--ease-standard)
const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]; // var(--ease-out)

// ─── 基准常量（与 design-tokens.css :root 同步，SSR 安全回退）───
export const MOTION = {
  /** var(--motion-fast) 120ms — 微交互 */
  fast: 0.12,
  /** var(--motion-base) 150ms — 状态切换 */
  base: 0.15,
  /** var(--motion-slow) 220ms — 模态 / 列表重排 */
  slow: 0.22,
  /** var(--motion-enter) 420ms — 页面 / 卡片入场 */
  enter: 0.42,
  /** var(--ease-standard) cubic-bezier(0.2, 0, 0, 1) */
  easeStandard: EASE_STANDARD,
  /** var(--ease-out) cubic-bezier(0.16, 1, 0.3, 1) */
  easeOut: EASE_OUT,
} as const;

// ─── Spring configs ───
// 对应 var(--spring-stiffness)=300 / var(--spring-damping)=30（见 §1.3 补充 token）
/** 精准快速：按钮反馈 / 状态切换，接近临界阻尼不过冲 */
export const springSnappy: Transition = { type: "spring", stiffness: 500, damping: 32, mass: 1 };
/** 平滑磁吸：Widget 拖拽释放吸附（对应 SPRING.magnetic / --spring-stiffness 300） */
export const springSmooth: Transition = { type: "spring", stiffness: 300, damping: 30, mass: 1 };
/** 弹性浮窗：长按浮窗菜单 / Toast 入场（对应 SPRING.menu / stiffness 400，略过冲） */
export const springBouncy: Transition = { type: "spring", stiffness: 400, damping: 28, mass: 1 };

// ─── Transition presets（tween，走 --motion-* 时长 + --ease-standard）───
/** var(--motion-fast) + var(--ease-standard) */
export const transitionFast: Transition = { duration: MOTION.fast, ease: EASE_STANDARD };
/** var(--motion-base) + var(--ease-standard) */
export const transitionBase: Transition = { duration: MOTION.base, ease: EASE_STANDARD };
/** var(--motion-slow) + var(--ease-standard) */
export const transitionSlow: Transition = { duration: MOTION.slow, ease: EASE_STANDARD };

// ─── Variants presets（供 motion 组件 initial/animate/exit 或 variants prop 使用）───
/** 纯淡入淡出 */
export const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

/** 淡入 + 微 slide-up（y: 8 → 0），页面切换默认 */
export const slideVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

/** 淡入 + 微缩放（scale: 0.96 → 1），模态 / 浮层 */
export const scaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
};

// ─── 运行时从 CSS custom properties 读取（感知 F6 三档 + prefers-reduced-motion）───

/** 解析 "120ms" → 0.12；SSR 或失败回退 fallback */
function readCssMs(varName: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  const ms = parseFloat(raw);
  return Number.isFinite(ms) ? ms / 1000 : fallback;
}

export interface MotionTokens {
  /** var(--motion-fast) 秒 */
  fast: number;
  /** var(--motion-base) 秒 */
  base: number;
  /** var(--motion-slow) 秒 */
  slow: number;
  /** var(--motion-enter) 秒 */
  enter: number;
  /** var(--ease-standard) */
  easeStandard: [number, number, number, number];
  /** var(--ease-out) */
  easeOut: [number, number, number, number];
  /** prefers-reduced-motion 或 F6 [data-motion="reduced"] 档，动画应瞬时 */
  reduced: boolean;
}

/**
 * 运行时读取 --motion-* CSS var，感知 [data-motion="reduced|standard|enhanced"] 三档。
 *
 * - 缓动用常量（cubic-bezier 字符串解析脆弱，且缓动不随 data-motion 变化）
 * - SSR 首屏返回常量回退（framer-motion 本就 hydration 后接管，见 §2.1 性能考量）
 * - `reduced` 综合 `useReducedMotion()`（系统级 prefers-reduced-motion）与 F6 reduced 档
 *
 * @returns MotionTokens，可直接用于构建 transition / variants
 */
export function useMotionTokens(): MotionTokens {
  const prefersReduced = useReducedMotion();
  const [tokens, setTokens] = useState<{ fast: number; base: number; slow: number; enter: number }>({
    fast: MOTION.fast,
    base: MOTION.base,
    slow: MOTION.slow,
    enter: MOTION.enter,
  });

  useEffect(() => {
    setTokens({
      fast: readCssMs("--motion-fast", MOTION.fast),
      base: readCssMs("--motion-base", MOTION.base),
      slow: readCssMs("--motion-slow", MOTION.slow),
      enter: readCssMs("--motion-enter", MOTION.enter),
    });
  }, []);

  // F6 [data-motion="reduced"] 会把 --motion-* 全设为 0ms
  const f6Reduced = tokens.fast === 0 && tokens.base === 0;
  const reduced = Boolean(prefersReduced) || f6Reduced;

  return {
    ...tokens,
    easeStandard: EASE_STANDARD,
    easeOut: EASE_OUT,
    reduced,
  };
}

/** re-export 便于消费侧一处导入 */
export { useReducedMotion };