"use client";

import { Fragment, type ReactNode } from "react";
import { Mermaid } from "@/components/Mermaid";

/**
 * 极简 Markdown 渲染器（零依赖，不使用 dangerouslySetInnerHTML）。
 * 覆盖决策记录实际会用到的语法：标题、列表、有序列表、引用、代码块、
 * 行内代码、加粗、斜体、链接、分隔线。未覆盖的语法按纯文本原样输出，
 * 保证不会因语法边界产生注入或渲染异常。
 */

/**
 * 链接 href 白名单（TC-PARSE-03 修复，渗透报告 P3-1）：
 * 仅放行 http(s) 绝对链接、站内路径与锚点。
 *
 * 关键细节 1：站内路径要求 `/` 后跟随非 `/` 字符或立即结束（`\/[^/]|\/$`），
 * 阻止协议相对 URL（如 `//evil.example/phish`）借 `\/` 分支漏网——
 * 浏览器会把 `//host/path` 解析为外部站点跳转（钓鱼向量）。
 *
 * 关键细节 2：站内路径分支同时排除反斜杠（`\/[^/\]`）。WHATWG URL 解析把
 * `/\` 视为进入 authority 状态，`/\evil.com` 会被解析为外站 evil.com——
 * 若放行将形成协议相对 URL 绕过（评审 m-1）。
 * 合法值不受影响：`/path`、`/`、`#anchor`、`/#anchor`、`https?://…`。
 *
 * 该白名单是本组件唯一的 URL 处理点（组件不渲染图片等其他含 URL 元素），
 * 若未来新增 img 等 URL 处理逻辑，必须复用同一正则。
 */
const SAFE_HREF_PATTERN = /^(https?:\/\/|\/[^/\\]|\/$|#)/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // 顺序：行内代码 → 链接 → 加粗 → 斜体
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const k = `${keyPrefix}-i${i++}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={k}
          className="px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--surface-2)] font-[family-name:var(--font-mono)] text-[0.9em] text-[var(--fg)]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const close = token.indexOf("](");
      const label = token.slice(1, close);
      const href = token.slice(close + 2, -1);
      const safe = SAFE_HREF_PATTERN.test(href) ? href : "#";
      nodes.push(
        <a
          key={k}
          href={safe}
          target={safe.startsWith("http") ? "_blank" : undefined}
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline underline-offset-2"
        >
          {label}
        </a>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={k} className="font-[var(--weight-semibold)] text-[var(--fg)]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={k} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      // mermaid 代码块 → 图表渲染（v0.4.0 队列第 3 项；决策/文档/评论三处通用）
      if (lang === "mermaid" && buf.length > 0) {
        blocks.push(<Mermaid key={key++} code={buf.join("\n")} />);
        continue;
      }
      blocks.push(
        <pre
          key={key++}
          className="my-3 p-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)] overflow-x-auto"
        >
          {lang && (
            <div className="mb-2 text-[length:var(--text-xs)] text-[var(--meta)] select-none">
              {lang}
            </div>
          )}
          <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--fg-2)] whitespace-pre">
            {buf.join("\n")}
          </code>
        </pre>,
      );
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-4 border-0 h-px bg-[var(--border)]" />);
      i++;
      continue;
    }

    // 标题：渲染为语义化 h1-h4，而非 <p>，保证文档大纲与 SEO 可访问性
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const fontSize =
        level === 1
          ? "var(--text-xl)"
          : level === 2
            ? "var(--text-lg)"
            : level === 3
              ? "var(--text-md)"
              : "var(--text-sm)";
      const HeadingTag = `h${level}` as "h1" | "h2" | "h3" | "h4";
      blocks.push(
        <HeadingTag
          key={key++}
          className="mt-4 mb-2 font-[var(--weight-semibold)] text-[var(--fg)]"
          style={{ fontSize }}
        >
          {renderInline(h[2], `h${key}`)}
        </HeadingTag>,
      );
      i++;
      continue;
    }

    // 引用
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-3 pl-3 border-l-2 border-[var(--border)] text-[var(--fg-2)]"
        >
          {renderInline(buf.join(" "), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // 无序 / 有序列表
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-3 space-y-1.5">
          {items.map((it, n) => (
            <li key={n} className="flex gap-2 text-[var(--fg-2)]">
              <span className="select-none text-[var(--meta)] shrink-0 tabular-nums">
                {ordered ? `${n + 1}.` : "·"}
              </span>
              <span>{renderInline(it, `l${key}-${n}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 段落（合并连续非空行）
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*(#{1,4}\s|>|[-*+]\s|\d+\.\s|```)/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2 text-[var(--fg-2)] leading-[1.7]">
        {renderInline(buf.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <Fragment>{blocks}</Fragment>;
}
