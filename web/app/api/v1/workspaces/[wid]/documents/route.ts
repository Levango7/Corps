import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/documents — 工作区文档列表
 * Query: ?q=<关键词>（标题/正文 ilike 模糊搜索）
 *        ?mine=1（仅我作为作者的）
 * 返回按 updatedAt 倒序
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    // B2：searchParams 经 zod 校验，非法值返回 400
    const parsed = listDocsQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      mine: url.searchParams.get("mine") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const q = parsed.data.q?.trim() || "";
    const mine = parsed.data.mine === "1";
    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(mine && ctx.payload.sub ? { authorId: ctx.payload.sub } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { markdown: { contains: q, mode: "insensitive" as const } },
              { publishedMarkdown: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [docs, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.document.findMany({
          where,
          select: {
            id: true,
            title: true,
            publishedAt: true,
            updatedAt: true,
            author: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ updatedAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.document.count({ where }),
      ]),
    );

    // R8C-06：统一分页响应格式 { code, data: { items, page, limit, total, hasMore } }
    return NextResponse.json({
      code: 200,
      data: { items: docs, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET documents] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const createDocSchema = z.object({
  title: z.string().min(1).max(255),
  markdown: z.string().optional(),
});

/**
 * GET 列表 searchParams 校验（B2）：
 *  - q: 关键词（标题/正文模糊搜索）
 *  - mine: "1" 表示仅我作为作者的文档
 *  - page: 页码（默认 1）
 *  - limit: 每页数量（默认 50，最大 100）
 */
const listDocsQuerySchema = z.object({
  q: z.string().optional(),
  mine: z.literal("1").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** POST /v1/workspaces/{wid}/documents — 新建文档 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createDocSchema.parse(body);

    const doc = await runWithWorkspace(
      wid,
      (tx) =>
        tx.document.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            markdown: validated.markdown ?? "",
            authorId: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: doc }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST document] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
