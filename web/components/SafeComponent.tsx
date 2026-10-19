"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "./ErrorBoundary";

interface SafeComponentProps {
  children: ReactNode;
  name?: string;
  fallback?: ReactNode;
}

/**
 * 默认兜底 UI：与 ErrorBoundary 的 DefaultErrorFallback 同款布局，但带上组件名。
 * 文案走 error 命名空间（与 ErrorBoundary 共用一份词条，不再本地硬编码）。
 */
function DefaultFallback({ name }: { name?: string }) {
  const t = useTranslations("error");
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 rounded-lg bg-[var(--surface-2)]">
      <p className="text-sm text-[var(--text-secondary)]">
        {name ? t("componentLoadFailed", { name }) : t("componentLoadFailedGeneric")}
      </p>
      <button
        onClick={() => window.location.reload()}
        className="text-xs text-[var(--accent-fg)] hover:underline"
      >
        {t("reloadRetry")}
      </button>
    </div>
  );
}

/** 统一 ErrorBoundary + fallback + 上报的工厂组件 */
export function SafeComponent({ children, name, fallback }: SafeComponentProps) {
  return (
    <ErrorBoundary fallback={fallback ?? <DefaultFallback name={name} />}>{children}</ErrorBoundary>
  );
}
