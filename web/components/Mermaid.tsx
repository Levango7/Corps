"use client";

/**
 * Mermaid 图表渲染组件（v0.4.0 队列第 3 项）。
 *
 * 用途：Markdown 中 ```mermaid 代码块 → 流程图/时序图/甘特图/mindmap 等。
 * 决策记录、文档中心、任务评论三处共用（均经 Markdown 组件分发到这里）。
 *
 * 设计要点：
 *  - 动态 import：mermaid 体积大（~1MB min+gz 前几百 KB），仅在页面真正出现
 *    mermaid 代码块时才加载（模块级单例 Promise，同页多图共享一次加载）。
 *  - 主题跟随：按 data-theme 初始化 dark/default，切换主题后重新渲染由
 *    RemixIcon 式外部触发……v1 简化：挂载时读取一次（刷新页面即生效）。
 *  - 安全：securityLevel: 'strict'（mermaid 内置 DOMPurify 清洗，禁 click 交互）。
 *  - 失败回退：解析失败（语法错/不支持图型）降级为普通代码块展示原文，
 *    不白屏不吞内容； mermaid.render 的 SVG 通过 innerHTML 注入——
 *    来源是 mermaid 自己的输出且 strict 模式已清洗，非用户原文直插。
 */

import { useEffect, useRef, useState } from "react";

type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | null = null;

/** 模块级单例动态加载（同页多图共享一次网络请求与解析） */
function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

let renderSeq = 0;

export function Mermaid({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const theme =
          document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const id = `mmd-${Date.now().toString(36)}-${renderSeq++}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    // 回退：按普通代码块展示原文（内容不丢，用户可修正语法）
    return (
      <pre className="my-3 p-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)] overflow-x-auto">
        <div className="mb-2 text-[length:var(--text-xs)] text-[var(--meta)] select-none">
          mermaid
        </div>
        <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--fg-2)] whitespace-pre">
          {code}
        </code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      data-mermaid=""
      className="my-3 p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border-soft)] overflow-x-auto text-center"
      role="img"
      aria-label={code.slice(0, 80)}
    />
  );
}
