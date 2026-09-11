import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { requirePermission } from "@/lib/permissions";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * POST /v1/workspaces/{wid}/documents/batch-export — 批量导出多文档
 *
 * F4 批量导出增强（任务 188）：
 *  - 接收 documentIds + format(html|pdf) + includeTableOfContents
 *  - 验证所有 documentIds 属于当前工作区（RLS 自动隔离）
 *  - 查询所有文档的 title + markdown
 *  - 生成合并 HTML：
 *      · 目录页（可选）：列出所有文档标题 + 页内锚点链接
 *      · 每个文档渲染为 HTML（轻量 Markdown → HTML，XSS 安全转义）
 *      · 文档间分页符（page-break-after: always）
 *  - 响应：{ code: 200, data: { html, documentCount } }
 *    前端拿到 html 后用 ExportPreview 批量模式预览 + window.print() 打印为 PDF
 *
 * 认证/RLS：getWorkspaceContext + runWithWorkspace + requirePermission(documents:read)
 */
const batchExportSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1).max(100),
  format: z.enum(["html", "pdf"]).default("pdf"),
  includeTableOfContents: z.boolean().default(true),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> },
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // 权限检查：documents:read
  const denied = await requirePermission(ctx, "documents", "read", req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const validated = batchExportSchema.parse(body);

    // 查询所有文档（RLS 自动过滤非本工作区文档）
    // 按 documentIds 顺序查询，保持用户选择的顺序
    const docs = await runWithWorkspace(
      wid,
      (tx) =>
        tx.document.findMany({
          where: {
            id: { in: validated.documentIds },
            workspaceId: wid,
          },
          select: {
            id: true,
            title: true,
            markdown: true,
            updatedAt: true,
            author: { select: { name: true, email: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (docs.length === 0) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
        { status: 404 },
      );
    }

    // 按请求 documentIds 顺序排序（findMany 不保证顺序）
    const docMap = new Map(docs.map((d) => [d.id, d]));
    const orderedDocs = validated.documentIds
      .map((id) => docMap.get(id))
      .filter((d): d is (typeof docs)[number] => !!d);

    // 生成合并 HTML
    const locale = getLocale(req);
    const html = buildBatchHtml(orderedDocs, validated.includeTableOfContents, locale);

    // 计算未找到的文档ID（请求的 documentIds 中未在数据库中找到的 ID）
    const foundIds = new Set(docs.map((d) => d.id));
    const skippedIds = validated.documentIds.filter((id) => !foundIds.has(id));

    return NextResponse.json({
      code: 200,
      data: {
        html,
        documentCount: orderedDocs.length,
        skippedIds,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          code: 400,
          message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"),
          data: null,
          errors: error.errors,
        },
        { status: 400 },
      );
    }
    console.error("[POST batch-export] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

// ─── HTML 生成 helpers ───

/** 从 Accept-Language 头检测 locale（zh / en），默认 en */
function getLocale(req: NextRequest): "zh" | "en" {
  const acceptLang = req.headers.get("accept-language") ?? "";
  return acceptLang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** 批量导出 HTML 文案映射 */
const BATCH_EXPORT_TEXTS = {
  zh: {
    tableOfContents: "目录",
    updatedOn: "更新于",
    batchExport: "批量导出",
    documentsSuffix: (n: number) => ` 等 ${n} 个文档`,
    lang: "zh-CN",
  },
  en: {
    tableOfContents: "Table of Contents",
    updatedOn: "Updated on",
    batchExport: "Batch Export",
    documentsSuffix: (n: number) => ` and ${n} more documents`,
    lang: "en",
  },
} as const;

interface DocForExport {
  id: string;
  title: string;
  markdown: string;
  updatedAt: Date;
  author: { name: string | null; email: string } | null;
}

/**
 * 生成批量导出合并 HTML：
 *  - 内嵌 <style> 提供基础排版 + 分页 + 打印友好样式
 *  - 可选目录页（每条目锚点链接到对应文档）
 *  - 每个文档渲染为 <section>，section 间 page-break-after: always
 *  - 所有用户输入经 escapeHtml / markdownToHtml 转义，无 dangerouslySetInnerHTML 注入风险
 */
function buildBatchHtml(docs: DocForExport[], includeToc: boolean, locale: "zh" | "en"): string {
  const t = BATCH_EXPORT_TEXTS[locale];
  const sections: string[] = [];

  // 内嵌样式：打印友好 + 分页 + 目录页排版
  const styles = `
    <style>
      * { box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        line-height: 1.6;
        color: #1a1a1a;
        max-width: 800px;
        margin: 0 auto;
        padding: 32px;
      }
      h1, h2, h3, h4 { font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; }
      h1 { font-size: 1.5em; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.3em; }
      h2 { font-size: 1.3em; }
      h3 { font-size: 1.15em; }
      h4 { font-size: 1em; }
      p { margin: 0.6em 0; }
      ul, ol { padding-left: 1.5em; }
      li { margin: 0.3em 0; }
      blockquote {
        border-left: 3px solid #d0d0d0;
        padding-left: 1em;
        color: #555;
        margin: 0.8em 0;
      }
      code {
        background: #f5f5f5;
        padding: 0.15em 0.35em;
        border-radius: 3px;
        font-family: "SFMono-Regular", Consolas, monospace;
        font-size: 0.9em;
      }
      pre {
        background: #f5f5f5;
        padding: 0.8em;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0.8em 0;
      }
      pre code { background: none; padding: 0; }
      hr { border: none; border-top: 1px solid #e5e5e5; margin: 1.5em 0; }
      a { color: #2563eb; text-decoration: none; }
      a:hover { text-decoration: underline; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      th, td { border: 1px solid #ddd; padding: 0.5em 0.8em; text-align: left; }
      th { background: #f5f5f5; font-weight: 600; }
      .toc { margin-bottom: 2em; }
      .toc h1 { border-bottom: 2px solid #2563eb; padding-bottom: 0.4em; }
      .toc ol { list-style: decimal; padding-left: 1.8em; }
      .toc li { margin: 0.5em 0; }
      .toc a { font-weight: 500; }
      .doc-section { page-break-after: always; }
      .doc-section:last-child { page-break-after: auto; }
      .doc-meta {
        color: #888;
        font-size: 0.85em;
        margin-bottom: 1em;
        border-bottom: 1px solid #f0f0f0;
        padding-bottom: 0.5em;
      }
      @media print {
        body { max-width: none; margin: 0; padding: 1cm; }
        .doc-section { page-break-after: always; }
      }
    </style>
  `;

  // 目录页
  if (includeToc) {
    const tocItems = docs
      .map(
        (d, i) =>
          `      <li><a href="#doc-${i}">${escapeHtml(d.title)}</a></li>`,
      )
      .join("\n");
    sections.push(`    <section class="doc-section toc">
      <h1>${escapeHtml(t.tableOfContents)}</h1>
      <ol>
${tocItems}
      </ol>
    </section>`);
  }

  // 每个文档渲染为一个 section
  docs.forEach((doc, i) => {
    const authorName = doc.author?.name || doc.author?.email || "";
    const metaLine = [
      authorName,
      `${t.updatedOn} ${doc.updatedAt.toLocaleString()}`,
    ]
      .filter(Boolean)
      .join(" · ");

    const bodyHtml = markdownToHtml(doc.markdown);

    sections.push(`    <section class="doc-section" id="doc-${i}">
      <h1>${escapeHtml(doc.title)}</h1>
      <div class="doc-meta">${escapeHtml(metaLine)}</div>
      ${bodyHtml}
    </section>`);
  });

  return `<!DOCTYPE html>
<html lang="${t.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(t.batchExport)} - ${escapeHtml(docs[0]?.title ?? "")}${docs.length > 1 ? t.documentsSuffix(docs.length) : ""}</title>
${styles}
  </head>
  <body>
${sections.join("\n")}
  </body>
</html>`;
}

/**
 * 轻义 HTML 特殊字符，防 XSS。
 * 必须在所有用户可控文本插入 HTML 上下文前调用。
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 轻义行内 HTML 后再处理 Markdown 行内语法（加粗/斜体/行内代码/链接）。
 * 输入文本先整体 escapeHtml，保证原始 <script> 等标签不可能进入输出。
 */
function renderInline(text: string): string {
  const escaped = escapeHtml(text);
  // 行内代码：`code` → <code>code</code>（先处理，避免内部被其他规则误处理）
  let out = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  // 加粗：**text** → <strong>text</strong>
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 斜体：*text* → <em>text</em>
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // 链接：[label](href) → <a href="href">label</a>（href 经白名单过滤）
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, label: string, href: string) => {
      const safeHref = SAFE_HREF_PATTERN.test(href) ? href : "#";
      return `<a href="${escapeHtml(safeHref)}">${label}</a>`;
    },
  );
  return out;
}

/**
 * 链接 href 白名单：仅放行 http(s) 绝对链接、站内路径与锚点。
 * 与 web/components/Markdown.tsx 的 SAFE_HREF_PATTERN 同源。
 */
const SAFE_HREF_PATTERN = /^(https?:\/\/|\/[^/\\]|\/$|#)/;

/**
 * 轻量 Markdown → HTML 渲染器（服务端，零依赖，XSS 安全）。
 *
 * 覆盖语法：标题(h1-h4)、代码块、引用、无序/有序列表、分隔线、段落、
 * 行内代码/加粗/斜体/链接。所有文本先经 escapeHtml 再处理语法，杜绝 XSS。
 *
 * 与 web/components/Markdown.tsx 的客户端渲染器对齐语法覆盖度，
 * 但输出为 HTML 字符串（服务端批量导出场景）。
 */
function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trimStart().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      blocks.push(
        `<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push("<hr />");
      i++;
      continue;
    }

    // 标题 h1-h4
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      blocks.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
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
      blocks.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
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
      const tag = ordered ? "ol" : "ul";
      const itemsHtml = items
        .map((it) => `        <li>${renderInline(it)}</li>`)
        .join("\n");
      blocks.push(`      <${tag}>\n${itemsHtml}\n      </${tag}>`);
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
    blocks.push(`      <p>${renderInline(buf.join(" "))}</p>`);
  }

  return blocks.join("\n");
}