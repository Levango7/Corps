// 文档格式转换 API
// POST /api/v1/workspaces/{wid}/documents/{id}/convert
//
// 设计：
//  - 在 markdown ↔ html 之间互转，返回转换后纯文本（不落库）
//  - 输入源可来自 body.content（指定内容）或文档自身 markdown（默认）
//  - 零依赖手写转换器：覆盖标题/列表/引用/代码块/链接/加粗/斜体/行内代码
//    等决策记录实际用到的语法，避免引入 marked/turndown 增加 bundle
//  - HTML 输出做基础转义（& < >），杜绝 XSS
//  - 需要 documents:read 权限（仅读取并转换，不修改文档）
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { requirePermission } from "@/lib/permissions";
import { logger } from "@/lib/logger";

const convertSchema = z.object({
  /** 目标格式：html = markdown→html；markdown = html→markdown */
  format: z.enum(["html", "markdown"]),
  /** 待转换内容；不传则取文档自身 markdown 字段 */
  content: z.string().max(1_000_000).optional(),
});

/** HTML 实体转义：&, <, >, ", ' —— 防止 XSS */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 行内 markdown → html：行内代码、加粗、斜体、链接 */
function inlineMdToHtml(text: string): string {
  let out = escapeHtml(text);
  // 行内代码 `xxx`（先处理避免被加粗/斜体吃掉）
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // 加粗 **xxx**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 斜体 *xxx*
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // 链接 [label](href) —— href 仅放行 http(s) 与站内路径
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, href: string) => {
      const safe = /^(https?:\/\/|\/[^/\\]|\/$|#)/.test(href) ? href : "#";
      const rel = safe.startsWith("http") ? ' rel="noopener noreferrer"' : "";
      const target = safe.startsWith("http") ? ' target="_blank"' : "";
      return `<a href="${safe}"${target}${rel}>${label}</a>`;
    },
  );
  return out;
}

/** markdown → html：块级 + 行内转换 */
function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
      html.push(
        `<pre${langAttr}><code>${escapeHtml(buf.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push("<hr />");
      i++;
      continue;
    }

    // 标题 h1-h4
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      html.push(`<h${level}>${inlineMdToHtml(h[2])}</h${level}>`);
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
      html.push(`<blockquote>${inlineMdToHtml(buf.join(" "))}</blockquote>`);
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
      const lis = items.map((it) => `<li>${inlineMdToHtml(it)}</li>`).join("");
      html.push(`<${tag}>${lis}</${tag}>`);
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
    html.push(`<p>${inlineMdToHtml(buf.join(" "))}</p>`);
  }

  return html.join("\n");
}

/** html → markdown：反转义 + 块级 + 行内 */
function htmlToMarkdown(html: string): string {
  // 块级元素逐行处理；先归一化换行
  const normalized = html
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>(\n)?/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/(h[1-4])>\s*<\1[^>]*>/gi, "\n\n")
    .replace(/<\/li>\s*<li[^>]*>/gi, "\n")
    .replace(/<\/(ul|ol)>\s*<\1[^>]*>/gi, "\n\n");

  // 标题
  let md = normalized.replace(
    /<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_m, level: string, inner: string) =>
      `\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n`,
  );
  // 加粗
  md = md.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "**$2**");
  // 斜体
  md = md.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "*$2*");
  // 行内代码
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");
  // 链接
  md = md.replace(
    /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, label: string) => `[${stripTags(label).trim()}](${href})`,
  );
  // 引用
  md = md.replace(
    /<blockquote>([\s\S]*?)<\/blockquote>/gi,
    (_m, inner: string) =>
      "\n" +
      stripTags(inner)
        .trim()
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n") +
      "\n",
  );
  // 无序列表
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) => {
    const items = inner
      .split(/<li[^>]*>([\s\S]*?)<\/li>/gi)
      .filter((s, idx) => idx % 2 === 1)
      .map((it) => `- ${stripTags(it).trim()}`);
    return "\n" + items.join("\n") + "\n";
  });
  // 有序列表
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    const items = inner
      .split(/<li[^>]*>([\s\S]*?)<\/li>/gi)
      .filter((s, idx) => idx % 2 === 1)
      .map((it) => `- ${stripTags(it).trim()}`);
    return "\n" + items.join("\n") + "\n";
  });
  // 代码块
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    const code = inner.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "$1");
    return "\n```\n" + unescapeHtml(code.trim()) + "\n```\n";
  });
  // 分隔线
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");
  // 段落
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n");
  // 残除残余标签
  md = stripTags(md);
  // 反转义
  md = unescapeHtml(md);
  // 折叠多余空行
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

/** 移除所有 HTML 标签，仅保留文本 */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/** 反转义 HTML 实体 */
function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** POST /v1/workspaces/{wid}/documents/{id}/convert — 格式转换 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> },
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  // documents:read 权限检查
  const denied = await requirePermission(ctx, "documents", "read", req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = convertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: 400,
          message: apiMsg(req, "validationFailed"),
          errors: parsed.error.errors,
          data: null,
        },
        { status: 400 },
      );
    }
    const { format, content } = parsed.data;

    // 若未传 content，从文档自身读取 markdown
    let source = content;
    if (source === undefined) {
      const doc = await runWithWorkspace(
        wid,
        (tx) =>
          tx.document.findFirst({
            where: { id, workspaceId: wid },
            select: { markdown: true },
          }),
        ctx.payload.sub,
      );
      if (!doc) {
        return NextResponse.json(
          { code: 404, message: apiMsg(req, "documentNotFound"), data: null },
          { status: 404 },
        );
      }
      source = doc.markdown;
    }

    const result = format === "html" ? markdownToHtml(source) : htmlToMarkdown(source);

    logger.info("document.convert", {
      wid,
      id,
      format,
      inLen: source.length,
      outLen: result.length,
    });

    return NextResponse.json({
      code: 0,
      data: { content: result, format },
      message: apiMsg(req, "ok"),
    });
  } catch (error) {
    logger.error("document.convert error", { wid, id, error: String(error) });
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}