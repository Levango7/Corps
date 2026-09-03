import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

/**
 * GET /v1/workspaces/{wid}/documents — 工作区文档列表
 * Query: ?q=<关键词>（标题/正文 ilike 模糊搜索）
 *        ?mine=1（仅我作为作者的）
 * 返回按 updatedAt 倒序
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const mine = url.searchParams.get("mine") === "1";

    const docs = await runWithWorkspace(wid, (tx) =>
      tx.document.findMany({
        where: {
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
        },
        select: {
          id: true,
          title: true,
          publishedAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 200,
      }),
    );

    return NextResponse.json({ code: 200, data: docs });
  } catch (error) {
    console.error("[GET documents] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}

const createDocSchema = z.object({
  title: z.string().min(1).max(255),
  markdown: z.string().optional(),
});

/** POST /v1/workspaces/{wid}/documents — 新建文档 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

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
        { code: 400, message: error.issues[0]?.message ?? "参数校验失败" },
        { status: 400 },
      );
    }
    console.error("[POST document] error:", error);
    return NextResponse.json({ code: 500, data: null, message: "服务器内部错误" }, { status: 500 });
  }
}
