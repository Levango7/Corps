"use client";

/**
 * F3 Widget — 错误状态组件（client component）。
 *
 * 包含 onClick 重试交互，必须保持 client component。
 * 从 WidgetStates.tsx 拆分出来，以便 WidgetSkeleton/WidgetEmpty 可作为 server component。
 */

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

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