"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { FieldFrame, FIELD_CONTROL_CLASS } from "./field-frame";
import { cn } from "./cn";

/**
 * Textarea —— 多行文本输入原语。
 *
 * 与 Input 的差异只有一行：高度由 `rows` 决定（默认 3），并有 `min-h` 兜底。
 * a11y 契约与 Input 完全一致（label 关联 / aria-invalid / aria-describedby / aria-required）。
 */
export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  id?: string;
  error?: string;
  hint?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, id, error, hint, required, className, rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? `textarea-${autoId}`;
  const messageId = `${areaId}-msg`;

  return (
    <FieldFrame
      htmlFor={areaId}
      label={label}
      messageId={messageId}
      error={error}
      hint={hint}
      required={required}
      className={className}
    >
      <textarea
        ref={ref}
        id={areaId}
        rows={rows}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={cn(
          FIELD_CONTROL_CLASS,
          "py-[var(--space-2)] min-h-20 border-[var(--border)] resize-y",
        )}
        {...rest}
      />
    </FieldFrame>
  );
});
