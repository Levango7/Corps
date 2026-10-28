"use client";

import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * 表单控件的公共外壳（**内部件**，不作为 11 个原语之一对外导出）。
 *
 * 存在的理由：Input / Textarea / Select 三个原语的 label + 错误 + 提示三件套完全同构。
 * 复制三遍就是我们在消灭的那种重复；抽成一个纯展示件，三者各自只负责把
 * aria-invalid / aria-describedby 接到自己的控件上。
 *
 * 这里只做**视觉与 id 接线**，不持有状态、不碰焦点。
 */
export interface FieldFrameProps {
  /** 控件的 id（label 的 htmlFor 与它对应） */
  htmlFor: string;
  label: string;
  /** 错误文案的 id；有错误时控件的 aria-describedby 要指向它 */
  messageId: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /** 布局类（宽度等），允许覆盖 */
  className?: string;
  children: ReactNode;
}

export function FieldFrame({
  htmlFor,
  label,
  messageId,
  error,
  hint,
  required,
  className,
  children,
}: FieldFrameProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[length:var(--text-xs)] font-[weight:var(--weight-medium)] text-[var(--fg-2)]"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-[var(--danger)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {(error || hint) && (
        <p
          id={messageId}
          // 错误用 alert：读屏会在值变化时主动播报；提示只是普通描述文本
          role={error ? "alert" : undefined}
          className={cn(
            "text-[length:var(--text-xs)]",
            error ? "text-[var(--danger)]" : "text-[var(--meta)]",
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** 三个控件共用的输入框外观（状态色由 aria-invalid 驱动，避免两套真值）。 */
export const FIELD_CONTROL_CLASS =
  "w-full px-[var(--space-3)] rounded-[var(--radius-md)] border bg-[var(--surface)] " +
  "text-[length:var(--text-sm)] text-[var(--fg)] " +
  "placeholder:text-[var(--meta)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] " +
  "aria-[invalid=true]:border-[var(--danger)] " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
