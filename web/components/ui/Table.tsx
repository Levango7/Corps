import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Table —— 语义表格原语（纯展示，无排序/选择/虚拟化）。
 *
 * 为什么要有：DESIGN.md 明确要求 `th scope`，而现有页面各自手写 `<table>`，
 * 表头经常只有样式没有 `scope`，读屏无法把单元格和列头关联起来。
 *
 * 这里只保证语义与基础外观，**不做**排序、列宽拖拽、行选择、虚拟滚动——
 * 那些属于数据表格（`components/database/TableView` 已有另一套，别混）。
 *
 * 横向溢出放在外层容器上：表格自身 `w-full`，窄屏时外层滚动，避免整页横向滚动条。
 */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-[length:var(--text-sm)]", className)}
        {...rest}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn("text-[var(--muted)]", className)} {...rest}>
      {children}
    </thead>
  );
}

export function TBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={className} {...rest}>
      {children}
    </tbody>
  );
}

export function TR({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("border-b border-[var(--border-soft)]", className)} {...rest}>
      {children}
    </tr>
  );
}

/** 表头单元格。`scope` 默认 `col`——这是读屏关联列头的唯一依据，别关掉。 */
export function TH({
  scope = "col",
  className,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn(
        "px-[var(--space-3)] py-[var(--space-2)] text-left font-[weight:var(--weight-medium)]",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-[var(--space-3)] py-[var(--space-2)] align-middle", className)} {...rest}>
      {children}
    </td>
  );
}

/** 表格的加载/空态占位（跨列铺满，避免"空表格"被读成无数据区域） */
export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-[var(--space-3)] py-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--meta)]"
      >
        {children}
      </td>
    </tr>
  );
}
