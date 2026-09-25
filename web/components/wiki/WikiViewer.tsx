import { Fragment, type ReactNode } from "react";

/**
 * WikiViewer — 极简 Markdown 渲染查看器（零外部依赖）。
 *
 * 支持语法：标题（h1-h3）、无序/有序列表、引用、代码块、行内代码、
 * 加粗、斜体、链接、分隔线。用正则替换实现，不使用 dangerouslySetInnerHTML，
 * 避免 XSS 风险。
 *
 * 链接 href 白名单：仅放行 http(s) 绝对链接、站内路径与锚点。
 */
const SAFE_HREF_PATTERN = /^(https?:\/\/|\/[^/\\]|\/$|#)/;

/** 行内元素渲染：行内代码 → 链接 → 加粗 → 斜体 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
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
      const linkM = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkM) {
        const [, label, href] = linkM;
        if (SAFE_HREF_PATTERN.test(href)) {
          nodes.push(
            <a
              key={k}
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)]"
            >
              {label}
            </a>,
          );
        } else {
          nodes.push(label);
        }
      }
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={k} className="font-[weight:var(--weight-semibold)] text-[var(--fg)]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
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

/** 块级元素渲染：逐行解析，代码块整段合并 */
function renderBlocks(md: string): ReactNode[] {
  const lines = md.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```...```
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 ```
      blocks.push(
        <pre
          key={`blk-${key++}`}
          className="my-[var(--space-3)] p-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--border-soft)] overflow-x-auto"
        >
          <code className="font-[family-name:var(--font-mono)] text-[length:var(--text-sm)] text-[var(--fg)] whitespace-pre">
            {codeLines.join("\n")}
          </code>
        </pre>,
      );
      continue;
    }

    // 空行
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 标题 h1-h3
    const headingM = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingM) {
      const [, hashes, text] = headingM;
      const level = hashes.length;
      const cls =
        level === 1
          ? "text-[length:var(--text-xl)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mt-[var(--space-4)] mb-[var(--space-2)]"
          : level === 2
            ? "text-[length:var(--text-lg)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mt-[var(--space-3)] mb-[var(--space-2)]"
            : "text-[length:var(--text-base)] font-[weight:var(--weight-semibold)] text-[var(--fg)] mt-[var(--space-3)] mb-[var(--space-1)]";
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      blocks.push(
        <Tag key={`blk-${key++}`} className={cls}>
          {renderInline(text, `h-${key}`)}
        </Tag>,
      );
      i++;
      continue;
    }

    // 分隔线
    if (/^---+$/.test(line.trim())) {
      blocks.push(
        <hr
          key={`blk-${key++}`}
          className="my-[var(--space-4)] border-0 border-t border-[var(--border)]"
        />,
      );
      i++;
      continue;
    }

    // 引用
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push(
        <blockquote
          key={`blk-${key++}`}
          className="my-[var(--space-3)] pl-[var(--space-4)] border-l-2 border-[var(--accent)] text-[var(--fg-2)] italic"
        >
          {quoteLines.map((q, qi) => (
            <p key={`q-${key}-${qi}`}>{renderInline(q, `q-${key}-${qi}`)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul
          key={`blk-${key++}`}
          className="my-[var(--space-2)] ml-[var(--space-5)] list-disc text-[var(--fg)] space-y-1"
        >
          {items.map((item, ii) => (
            <li key={`li-${key}-${ii}`}>{renderInline(item, `li-${key}-${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol
          key={`blk-${key++}`}
          className="my-[var(--space-2)] ml-[var(--space-5)] list-decimal text-[var(--fg)] space-y-1"
        >
          {items.map((item, ii) => (
            <li key={`ol-${key}-${ii}`}>{renderInline(item, `ol-${key}-${ii}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // 普通段落（连续非空非特殊行合并）
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim()) &&
      !lines[i].startsWith("> ") &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(
        <p
          key={`blk-${key++}`}
          className="my-[var(--space-2)] text-[var(--fg)] leading-[var(--leading-relaxed)]"
        >
          {paraLines.map((p, pi) => (
            <Fragment key={`p-${key}-${pi}`}>
              {renderInline(p, `p-${key}-${pi}`)}
              {pi < paraLines.length - 1 && <br />}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return blocks;
}

export function WikiViewer({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div className="py-[var(--space-12)] text-center text-[var(--muted)] text-[length:var(--text-sm)]">
        —
      </div>
    );
  }
  return (
    <article className="wiki-viewer text-[length:var(--text-sm)] leading-[var(--leading-relaxed)]">
      {renderBlocks(content)}
    </article>
  );
}
