"use client";

import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { FieldFrame, FIELD_CONTROL_CLASS } from "./field-frame";
import { cn } from "./cn";

/**
 * Select —— 单选原语。
 *
 * 刻意用**原生 `<select>`**：本仓有 64 处自建弹窗却几乎没有焦点管理（实测 FocusTrap
 * 的真实消费者只有 1 个），再手搓一个 listbox 等于自己造一个更难测的交互层。
 * 原生 select 的键盘、读屏、移动端滚轮选择都是浏览器给的，且 `aria-*` 语义天然正确。
 *
 * 需要多选 / 可搜索下拉时不要在本组件上加开关——那是另一个原语，另开一轮。
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "children"
> {
  label: string;
  id?: string;
  options: readonly SelectOption[];
  /** 空值占位项（不给则没有"未选择"状态） */
  placeholder?: string;
  error?: string;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, id, options, placeholder, error, hint, required, className, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? `select-${autoId}`;
  const messageId = `${selectId}-msg`;

  return (
    <FieldFrame
      htmlFor={selectId}
      label={label}
      messageId={messageId}
      error={error}
      hint={hint}
      required={required}
      className={className}
    >
      <select
        ref={ref}
        id={selectId}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        className={cn(FIELD_CONTROL_CLASS, "h-9 border-[var(--border)]")}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled={required}>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
});
