"use client";

/**
 * 路由级 Error Boundary · app/error.tsx
 *
 * Next.js App Router 自动捕获子路由段渲染时抛出的未处理异常，
 * 替换出错的路由段为本组件，保留 root layout（顶栏/侧栏/全局 CSS 不丢失）。
 *
 * - error：捕获到的错误对象（含 Next.js 注入的 digest 用于服务端定位）
 * - reset：重置错误边界，重新渲染出错的路由段
 *
 * 仅处理渲染期错误；事件回调中的错误需自行 try/catch。
 */

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error] 路由级错误边界捕获：", error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="min-h-[60vh] flex items-center justify-center px-[var(--space-4)]"
    >
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-[var(--elev-sm)] p-[var(--space-6)] text-center">
        <AlertTriangle size={40} className="mx-auto text-[var(--danger)] mb-4" strokeWidth={1.5} />
        <h2 className="text-[length:var(--text-xl)] font-[var(--weight-semibold)] text-[var(--fg)] mb-2">
          页面出错了
        </h2>
        <p className="text-[length:var(--text-sm)] text-[var(--muted)] mb-1">
          渲染过程中发生了意外错误，可以尝试重新加载。
        </p>
        {error.digest && (
          <p className="text-[length:var(--text-xs)] text-[var(--meta)] font-[family-name:var(--font-mono)] mb-4 break-all">
            错误编号：{error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-[var(--space-2)] mt-5">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 h-9 px-4 bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-[var(--weight-medium)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] transition-colors duration-[var(--motion-base)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
          >
            <RefreshCw size={15} />
            重试
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center h-9 px-4 rounded-[var(--radius-md)] border border-[var(--border)] text-[length:var(--text-sm)] font-[var(--weight-medium)] text-[var(--fg-2)] hover:bg-[var(--surface-2)] transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:outline-none"
          >
            刷新页面
          </button>
        </div>
      </div>
    </div>
  );
}
