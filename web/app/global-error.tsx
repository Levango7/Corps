"use client";

/**
 * 全局 Error Boundary · app/global-error.tsx
 *
 * Next.js App Router 最高级别错误边界，捕获 root layout（app/layout.tsx）
 * 渲染时抛出的未处理异常。当 root layout 出错时，整个 html/body 由本组件替换，
 * 因此必须自带 <html> 与 <body> 标签，并手动导入全局样式（globals.css）。
 *
 * - error：捕获到的错误对象（含 Next.js 注入的 digest）
 * - reset：重置错误边界，重新渲染 root layout
 *
 * 样式策略：root layout 出错时 Tailwind 全局 CSS 可能尚未就绪，
 * 故使用内联样式 + 系统字体栈 + 安全色值，确保任何场景下都能渲染可读的错误页。
 */

import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error] 全局错误边界捕获：", error);
  }, [error]);

  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily: '"Inter", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
          background: "#f7f8f9",
          color: "#1a2128",
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e3e6e8",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(16,24,29,0.06)",
            padding: "1.5rem",
            textAlign: "center",
          }}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#dc2626"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ margin: "0 auto 1rem", display: "block" }}
            aria-hidden="true"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              margin: "0 0 0.5rem",
            }}
          >
            应用发生严重错误
          </h2>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#6b7280",
              margin: "0 0 0.25rem",
            }}
          >
            页面渲染时发生未预期的异常，请尝试重试或刷新。
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#9ca3af",
                fontFamily: "monospace",
                margin: "0 0 1rem",
                wordBreak: "break-all",
              }}
            >
              错误编号：{error.digest}
            </p>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              marginTop: "1.25rem",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                height: "2.25rem",
                padding: "0 1rem",
                background: "#2563eb",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: "2.25rem",
                padding: "0 1rem",
                background: "transparent",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "8px",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              刷新页面
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
