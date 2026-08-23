"use client";

/**
 * 截止日期标签 —— 共享组件。
 *
 * board 页曾内联定义 DueTag，my-tasks 又用 inline span 重复实现一套。
 * 统一抽取为共享组件，支持 inline（单行内 "· 3天后"）与 block（独立一行）两种形态。
 *
 * 所有色值走 var(--token)，无裸 hex。
 */

import { formatRelativeDueDate } from "@/lib/format";

interface DueTagProps {
  dueDate: string;
  /** inline=true 用于单行内（"· 3天后"），否则独立一行。 */
  inline?: boolean;
}

export function DueTag({ dueDate, inline = false }: DueTagProps) {
  const due = formatRelativeDueDate(dueDate);
  const toneClass =
    due.tone === "overdue"
      ? "text-[var(--danger)]"
      : due.tone === "today"
        ? "text-[var(--warn)]"
        : "text-[var(--muted)]";
  if (inline) return <span className={toneClass}>· {due.text}</span>;
  return <p className={`text-xs mt-1 ${toneClass}`}>{due.text}</p>;
}