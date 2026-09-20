/**
 * F3 Widget — 共享加载/空状态组件（server component）。
 *
 * WidgetSkeleton 和 WidgetEmpty 是纯展示组件，适合作为 server component。
 * WidgetError 已拆分到 WidgetError.tsx（client component，有 onClick 交互）。
 *
 * 各 Widget 复用，避免重复代码。所有样式走 design token。
 */

import { Inbox } from "lucide-react";
import { Skeleton } from "@/components/Skeleton";

// Re-export WidgetError 以保持现有导入路径兼容
export { WidgetError } from "./WidgetError";

/** 加载骨架：N 行占位 */
export function WidgetSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="p-3 space-y-2" aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4" style={{ maxWidth: `${60 + ((i * 37) % 36)}%` }} />
      ))}
    </div>
  );
}

/** 空状态：图标 + 文案 */
export function WidgetEmpty({ text }: { text: string }) {
  return (
    <div className="p-4 flex flex-col items-center text-center">
      <Inbox size={20} className="text-[var(--muted)] opacity-40 mb-1.5" strokeWidth={1.5} />
      <p className="text-[length:var(--text-xs)] text-[var(--meta)]">{text}</p>
    </div>
  );
}
