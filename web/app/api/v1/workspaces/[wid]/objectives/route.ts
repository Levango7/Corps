import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/objectives — OKR 目标列表
 * Query: ?period=2026-Q1 &status=active &page=1 &limit=50
 * 返回按 updatedAt 倒序，含 keyResults 数量
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse({
      period: url.searchParams.get("period") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { period, status, page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      workspaceId: wid,
      ...(period ? { period } : {}),
      ...(status ? { status } : {}),
    };

    const [items, total] = await runWithWorkspace(
      wid,
      (tx) =>
        Promise.all([
          tx.objective.findMany({
            where,
            select: {
              id: true,
              title: true,
              description: true,
              ownerId: true,
              period: true,
              status: true,
              progress: true,
              createdAt: true,
              updatedAt: true,
              owner: { select: { id: true, name: true, email: true } },
              _count: { select: { keyResults: true } },
            },
            orderBy: [{ updatedAt: "desc" }],
            skip,
            take: limit,
          }),
          tx.objective.count({ where }),
        ]),
      ctx.payload.sub,
    );

    return NextResponse.json({
      code: 200,
      data: { items, page, limit, total, hasMore: page * limit < total },
    });
  } catch (error) {
    console.error("[GET objectives] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const listQuerySchema = z.object({
  period: z.string().optional(),
  status: z.enum(["draft", "active", "completed", "archived"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  period: z.string().min(1).max(20),
  status: z.enum(["draft", "active", "completed", "archived"]).optional(),
});

/** POST /v1/workspaces/{wid}/objectives — 创建目标 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    const obj = await runWithWorkspace(
      wid,
      (tx) =>
        tx.objective.create({
          data: {
            workspaceId: wid,
            title: validated.title,
            description: validated.description,
            ownerId: validated.ownerId ?? ctx.payload.sub,
            period: validated.period,
            status: validated.status ?? "draft",
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 201, data: obj }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST objective] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}