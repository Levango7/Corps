"use client";

/**
 * 全局 Error Boundary · app/global-error.tsx
 *
 * Next.js App Router 最高级别错误边界，捕获 root layout 渲染时抛出的未处理异常。
 * 当 root layout 出错时，整个 html/body 由本组件替换，因此必须自带 <html> 与
 * <body> 标签，并手动导入全局样式（globals.css）。
 *
 * - error：捕获到的错误对象（含 Next.js 注入的 digest）
 * - reset：重置错误边界，重新渲染 root layout
 *
 * ⚠️ 重要约束：本组件在 React 树中位于 root layout **之上**，
 * 而 NextIntlClientProvider 挂载在 app/[locale]/layout.tsx（本项目无 app/layout.tsx，
 * 根布局即 [locale]/layout.tsx）。因此这里 **不能使用 useTranslations()** ——
 * 一旦调用就会抛
 *   "Failed to call `useTranslations` because the context from
 *    `NextIntlClientProvider` was not found."
 * 导致兜底错误页自身崩溃、用户看到纯白屏，错误边界彻底失效。
 *
 * 故本文件改为零依赖的内置文案：不 import next-intl，不依赖任何 Context/Provider。
 * 修改本文件时请保持这一约束，勿改回 useTranslations。
 *
 * 语言策略：SSR 阶段固定输出默认 locale（zh，与项目 localePrefix: "as-needed" 的
 * 默认语言一致）；hydrate 后再按浏览器语言切换到 en。html 标签上的
 * suppressHydrationWarning 用于容忍这一切换带来的差异。
 *
 * 样式策略：root layout 出错时 Tailwind 全局 CSS 可能尚未就绪，
 * 故使用内联样式 + 系统字体栈 + 安全色值，确保任何场景下都能渲染可读的错误页。
 */

import { useEffect, useState } from "react";
import "./globals.css";

/** 错误页兜底文案（与 messages/{zh,en}.json 的 error.* / button.* 保持一致） */
const COPY = {
  zh: {
    fatalError: "应用发生严重错误",
    fatalErrorDesc: "页面渲染时发生未预期的异常，请尝试重试或刷新。",
    errorId: (digest: string) => `错误编号：${digest}`,
    retry: "重试",
    refresh: "刷新页面",
  },
  en: {
    fatalError: "A critical error occurred",
    fatalErrorDesc: "An unexpected error occurred while rendering the page. Try again or refresh.",
    errorId: (digest: string) => `Error ID: ${digest}`,
    retry: "Retry",
    refresh: "Refresh page",
  },
} as const;

type Lang = keyof typeof COPY;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // SSR 与首次渲染固定为默认 locale，避免服务端/客户端不一致
  const [lang, setLang] = useState<Lang>("zh");

  useEffect(() => {
    console.error("[global-error] 全局错误边界捕获：", error);
  }, [error]);

  // navigator 仅在客户端可用，故放在 useEffect 中读取
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("en")) {
      setLang("en");
    }
  }, []);

  const c = COPY[lang];

  return (
    <html lang={lang === "zh" ? "zh-CN" : "en"} data-theme="light" suppressHydrationWarning>
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
            {c.fatalError}
          </h2>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#6b7280",
              margin: "0 0 0.25rem",
            }}
          >
            {c.fatalErrorDesc}
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
              {c.errorId(error.digest)}
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
              {c.retry}
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
              {c.refresh}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
