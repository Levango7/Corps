"use client";

import { Component, type ReactNode } from "react";
import { useTranslations } from "next-intl";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * 默认兜底 UI（AC-22）。
 *
 * 抽成函数组件的唯一原因：`useTranslations` 是 Hook，而 ErrorBoundary 必须是
 * 类组件（错误边界没有函数式写法）。此前文案硬编码中文，英文用户看到中文。
 *
 * 前置条件：本组件依赖 NextIntlClientProvider。经由 SafeComponent 使用时
 * （app/[locale]/w/[wid]/** 下的重型编辑器与 AI 面板）provider 一定存在。
 * 注意 `app/global-error.tsx` 不能走 i18n（它在 root layout 之上、拿不到
 * provider），那个文件保持零 i18n 依赖、不要改成引用本组件。
 */
function DefaultErrorFallback({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("error");
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 rounded-lg bg-[var(--surface-2)] text-[var(--text-secondary)]">
      <p className="text-sm">{t("loadFailed")}</p>
      <button onClick={onRetry} className="text-xs text-[var(--accent-fg)] hover:underline">
        {t("retry")}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <DefaultErrorFallback onRetry={() => this.setState({ hasError: false, error: null })} />
        )
      );
    }
    return this.props.children;
  }
}
