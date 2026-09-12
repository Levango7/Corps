import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";
import { handlePrismaError } from "@/lib/prisma-error";

/**
 * 跨内容全文搜索 API
 *
 * GET /v1/workspaces/{wid}/search?q=keyword&type=all|document|task|decision&limit=20
 *
 * 搜索范围：
 *  - Document: title + markdown（ILIKE 模糊匹配）
 *  - Task:     title + description（ILIKE）
 *  - Decision: markdown（ILIKE；Decision 无 title 字段，用所属 task title 作展示标题）
 *
 * 返回统一格式：{ items: [{ type, id, title, snippet, href, updatedAt }] }
 *  - snippet 是匹配上下文摘要（匹配关键词前后各 50 字符），已 escapeHtml
 *  - 每类型最多 10 条，总上限 20
 *  - 权限：runWithWorkspace 确保租户隔离
 */

const querySchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(["all", "document", "task", "decision"]).default("all"),
  limit: z.string().nullish(),
});

/** 每类型返回上限 */
const PER_TYPE_LIMIT = 10;
/** 默认总上限 */
const DEFAULT_LIMIT = 20;
/** 总上限硬顶（防止过大 take 拖垮查询） */
const MAX_LIMIT = 100;
/** snippet 上下文半径（匹配关键词前后各 50 字符） */
const SNIPPET_RADIUS = 50;

/** 搜索结果统一项 */
interface SearchItem {
  type: "document" | "task" | "decision";
  id: string;
  title: string;
  snippet: string;
  href: string;
  updatedAt: string;
}

/**
 * 生成匹配上下文 snippet：在 text 中定位 query 命中位置，
 * 截取前后各 SNIPPET_RADIUS 字符。
 *
 * 返回原始文本（未 HTML 转义）——前端用 React JSX 渲染时自动转义防 XSS，
 * 且 highlight 函数可正常在 snippet 上高亮关键词。
 * escapeHtml() 函数保留供非 React 客户端使用。
 *
 * 若 text 为空或未命中，返回 text 的前 (2 * SNIPPET_RADIUS) 字符摘要。
 */
function buildSnippet(text: string | null | undefined, query: string): string {
  const content = text ?? "";
  if (!content) return "";
  const lower = content.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) {
    // 未在 content 命中（可能在 title 命中）：返回开头摘要
    return content.slice(0, SNIPPET_RADIUS * 2);
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(content.length, idx + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return prefix + content.slice(start, end) + suffix;
}

/**
 * HTML 转义：防 snippet 注入 XSS（<>&"' 五个字符）。
 * 保留供非 React 客户端（如导出、邮件）使用；前端 React JSX 渲染自动转义。
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** GET /v1/workspaces/{wid}/search — 跨内容全文搜索 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx)
    return NextResponse.json(
      { code: 401, message: apiMsg(req, "unauthorized"), data: null },
      { status: 401 },
    );

  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q"),
      type: url.searchParams.get("type") ?? "all",
      limit: url.searchParams.get("limit"),
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }

    const q = parsed.data.q.trim();
    // trim 后若为空字符串（纯空格输入），返回 400 避免匹配全部记录
    if (!q) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "searchQueryBlank"), data: null },
        { status: 400 },
      );
    }

    // parseInt 后可能为 NaN，需兜底为默认值；clamp 到 [1, MAX_LIMIT]
    const parsedLimit = parseInt(parsed.data.limit ?? String(DEFAULT_LIMIT), 10);
    const limit = Number.isNaN(parsedLimit)
      ? DEFAULT_LIMIT
      : Math.min(Math.max(parsedLimit, 1), MAX_LIMIT);

    const type = parsed.data.type;
    const items: SearchItem[] = [];

    await runWithWorkspace(wid, async (tx) => {
      // ── Document 搜索：title + markdown ──
      if (type === "all" || type === "document") {
        const docs = await tx.document.findMany({
          where: {
            workspaceId: wid,
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { markdown: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true, title: true, markdown: true, updatedAt: true },
          take: PER_TYPE_LIMIT,
          orderBy: { updatedAt: "desc" },
        });
        for (const d of docs) {
          items.push({
            type: "document",
            id: d.id,
            title: d.title,
            snippet: buildSnippet(d.markdown, q),
            href: `/w/${wid}/documents/${d.id}`,
            updatedAt: d.updatedAt.toISOString(),
          });
        }
      }

      // ── Task 搜索：title + description ──
      if (type === "all" || type === "task") {
        const tasks = await tx.task.findMany({
          where: {
            workspaceId: wid,
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true, title: true, description: true, updatedAt: true },
          take: PER_TYPE_LIMIT,
          orderBy: { updatedAt: "desc" },
        });
        for (const t of tasks) {
          items.push({
            type: "task",
            id: t.id,
            title: t.title,
            snippet: buildSnippet(t.description, q),
            href: `/w/${wid}/task/${t.id}`,
            updatedAt: t.updatedAt.toISOString(),
          });
        }
      }

      // ── Decision 搜索：markdown（Decision 无 title 字段，用 task title 作展示标题）──
      if (type === "all" || type === "decision") {
        const decisions = await tx.decision.findMany({
          where: {
            workspaceId: wid,
            markdown: { contains: q, mode: "insensitive" },
          },
          select: {
            id: true,
            markdown: true,
            version: true,
            taskId: true,
            updatedAt: true,
            task: { select: { title: true } },
          },
          take: PER_TYPE_LIMIT,
          orderBy: { updatedAt: "desc" },
        });
        for (const d of decisions) {
          items.push({
            type: "decision",
            id: d.id,
            // 决策无独立 title：用所属任务标题 + 版本号作展示标题
            title: `${d.task.title} · v${d.version}`,
            snippet: buildSnippet(d.markdown, q),
            // 选中决策后跳转到决策列表页（任务要求）
            href: `/w/${wid}/decisions`,
            updatedAt: d.updatedAt.toISOString(),
          });
        }
      }
    });

    // 按 updatedAt 倒序排列，并截断到 limit
    items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const capped = items.slice(0, limit);

    return NextResponse.json({
      code: 200,
      data: { items: capped, total: capped.length },
    });
  } catch (error) {
    console.error("[GET search] error:", error);
    return handlePrismaError(error, req);
  }
}
