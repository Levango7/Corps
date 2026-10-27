"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Toolbar —— 一组操作按钮的容器（不是"按钮排版"）。
 *
 * ARIA：`role="toolbar"` + 必填 `label`。放在一起的操作需要有名字，
 * 否则读屏用户听到的是一串孤立按钮，不知道它们属于哪个区域。
 *
 * 边界（诚实说明）：ARIA 建议 toolbar 内用 roving tabindex + 方向键在按钮间移动。
 * 本批**没做**——那要求 Toolbar 接管子元素的 tabIndex，而现有调用点里按钮数量、
 * 是否含下拉、是否分组都不一致，现在实现大概率猜错。等 B3 迁移到真实调用点后再加，
 * 且必须有单测覆盖键盘行为才允许合并。
 */
export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  /** 工具条的可访问名称（必填） */
  label: string;
  /** 排列方向（默认横向） */
  orientation?: "horizontal" | "vertical";
  children: ReactNode;
}

export function Toolbar({
  label,
  orientation = "horizontal",
  className,
  children,
  ...rest
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      className={cn(
        "flex items-center gap-1",
        orientation === "vertical" && "flex-col items-stretch",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
