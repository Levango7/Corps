"use client";

/**
 * F3 Widget — 共享加载/错误/空状态组件。
 *
 * 各 Widget 复用，避免重复代码。所有样式走 design token。
 */

import { AlertTriangle, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/Skeleton";

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

/** 错误状态：图标 + 文案 + 重试按钮 */
export function WidgetError({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  const t = useTranslations("dashboard");
  const tButton = useTranslations("button");
  return (
    <div className="p-3 flex flex-col items-center text-center">
      <AlertTriangle size={20} className="text-[var(--muted)] opacity-50 mb-1.5" strokeWidth={1.5} />
      <p className="text-[length:var(--text-xs)] text-[var(--fg-2)]">{t("loadFailed")}</p>
      {message && (
        <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--meta)] truncate max-w-full">
          {message}
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 px-2 py-1 text-[length:var(--text-xs)] text-[var(--accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-2"
      >
        {tButton("retry")}
      </button>
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