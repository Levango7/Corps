"use client";

import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { FieldFrame, FIELD_CONTROL_CLASS } from "./field-frame";
import { cn } from "./cn";

/**
 * Input —— 单行文本输入原语。
 *
 * a11y 契约（单测逐条断言）：
 *  - `label` 必填，label 的 `for` 指向控件 id（自动生成，也可显式传 `id`）；
 *  - 有 `error` 时控件带 `aria-invalid="true"`，且 `aria-describedby` 指向错误文案；
 *  - `required` 同时落在 `aria-required`（不只是视觉星号）。
 *
 * 外观：`aria-invalid` 驱动危险色（见 field-frame 的 FIELD_CONTROL_CLASS），
 * 不引入第二套 `invalid` prop，避免"传了 error 忘了 invalid"的双真值。
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  /** 控件 id（默认自动生成；需要外部 label 时显式传） */
  id?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, error, hint, required, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;
  const messageId = `${inputId}-msg`;

  return (
    <FieldFrame
      htmlFor={inputId}
      label={label}
      messageId={messageId}
      error={error}
      hint={hint}
      required={required}
      className={className}
    >
      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={cn(FIELD_CONTROL_CLASS, "h-9 border-[var(--border)]")}
        {...rest}
      />
    </FieldFrame>
  );
});
