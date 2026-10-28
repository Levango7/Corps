"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Button —— 主按钮唯一入口（设计方案 §7.2 第 3 步的落点）。
 *
 * 为什么先建原语再迁移：全仓现在有 186 处「accent 背景 + accent-fg 文字」的
 * 主按钮类副本、247 处 accent 背景片段（实测口径见 PR）。换品牌色要人肉巡检，
 * 所以先有一个 variant 穷举外观的组件，迁移才有目标。
 *
 * ## 外观只走 variant，不走 className
 * 颜色/尺寸/状态全部由 variant + size 决定；`className` 只接布局类。
 * 理由见 ./cn.ts 顶部（无 tailwind-merge，覆盖不可靠）。
 *
 * ## 触摸目标
 * - `size="md"`（默认）：`h-11` = 44px，满足 DESIGN.md「所有可点元素 ≥44×44」。
 * - `size="sm"`：视觉 `h-8`（32px），但用 `after` 伪元素把**命中区**向外扩 6px×2
 *   → 实际 44px。这正是 DESIGN.md 写的「图标按钮用 padding 扩到 44，不靠视觉尺寸」，
 *   只是用伪元素实现，避免密集工具条被撑高。
 *
 * ## a11y
 * - 渲染原生 `<button type="button">`：键盘、读屏、焦点环都是浏览器原生行为。
 * - `loading` 时置 `aria-busy` 并禁用（禁用态仍保持可读，不用 `pointer-events` 假装）。
 * - icon-only 请用 `IconButton`：它把 `label` 做成必填并落到 `aria-label`，
 *   从类型层面杜绝"只有图标没有名字"（这是 a11y 违规里最常见的一类）。
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active disabled:hover:bg-accent",
  secondary:
    "bg-surface-2 text-fg border border-border hover:bg-surface-3 disabled:hover:bg-surface-2",
  ghost: "bg-transparent text-fg-2 hover:bg-hover-soft hover:text-fg disabled:hover:bg-transparent",
  danger: "bg-danger text-white hover:opacity-90 disabled:hover:opacity-100",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  // sm 的 after 伪元素把命中区往上/下各扩 6px：32 + 12 = 44px
  sm: "h-8 px-[var(--space-2)] text-[length:var(--text-xs)] rounded-[var(--radius-sm)] relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
  md: "h-11 px-[var(--space-3)] text-[length:var(--text-sm)] rounded-[var(--radius-md)]",
};

const BASE_CLASS =
  "inline-flex items-center justify-center gap-1.5 font-[weight:var(--weight-medium)] " +
  "transition-colors duration-[var(--motion-fast)] select-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 加载中：置 aria-busy 并禁用，避免重复提交 */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(BASE_CLASS, VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
  /** 无障碍名称（必填）：会被渲染成 aria-label。图标本身不是文本，缺了它读屏用户看不到按钮。 */
  label: string;
  children: ReactNode;
}

/**
 * 纯图标按钮。相比 `Button` 的差别只有一条：`label` 必填并落到 `aria-label`。
 * 这一条是**类型层面**的强制——漏写会编译失败，而不是等 a11y 扫描发现。
 *
 * 尺寸固定 44×44 命中区（用伪元素扩，见上），视觉上仍是 `sm` 的 32px。
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, variant = "ghost", size = "sm", className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      className={cn("w-8 shrink-0", className)}
      {...rest}
    >
      {children}
    </Button>
  );
});
