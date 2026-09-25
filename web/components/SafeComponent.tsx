"use client";

import { type ReactNode } from "react";
import { ErrorBoundary } from "./ErrorBoundary";

interface SafeComponentProps {
  children: ReactNode;
  name?: string;
  fallback?: ReactNode;
}

/** 统一 ErrorBoundary + fallback + 上报的工厂组件 */
export function SafeComponent({ children, name, fallback }: SafeComponentProps) {
  return (
    <ErrorBoundary
      fallback={
        fallback ?? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 rounded-lg bg-[var(--surface-2)]">
            <p className="text-sm text-[var(--text-secondary)]">
              {name ? `${name} 加载失败` : "组件加载失败"}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-[var(--accent-fg)] hover:underline"
            >
              刷新重试
            </button>
          </div>
        )
      }
    >
      {children}
    </ErrorBoundary>
  );
}
