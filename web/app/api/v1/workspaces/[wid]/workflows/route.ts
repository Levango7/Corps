import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/workflows — 工作流列表
 * Query: ?active=true（仅启用的）
 *        ?take=&skip= 分页
 * 返回按 updatedAt 倒序
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse({
      active: url.searchParams.get("active") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { code: 400, message: apiMsg(req, "validationFailed"), errors: parsed.error.errors, data: null },
        { status: 400 },
      );
    }
    const { active, take, skip } = parsed.data;

    const where = {
      workspaceId: wid,
      ...(active ? { active: true } : {}),
    };

    const [items, total] = await runWithWorkspace(wid, (tx) =>
      Promise.all([
        tx.workflow.findMany({
          where,
          select: {
            id: true,
            name: true,
            description: true,
            trigger: true,
            actions: true,
            active: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: "desc" }],
          skip,
          take,
        }),
        tx.workflow.count({ where }),
      ]),
    );

    return NextResponse.json({ code: 0, data: { items, total, skip, take } });
  } catch (error) {
    console.error("[GET workflows] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}

const listQuerySchema = z.object({
  active: z.literal("true").optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  trigger: z.record(z.unknown()),
  actions: z.array(z.record(z.unknown())).min(1),
  active: z.boolean().optional(),
});

/** POST /v1/workspaces/{wid}/workflows — 创建工作流 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createSchema.parse(body);

    const wf = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workflow.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            description: validated.description,
            trigger: validated.trigger as Prisma.InputJsonValue,
            actions: validated.actions as Prisma.InputJsonValue,
            active: validated.active ?? true,
            createdBy: ctx.payload.sub,
          },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 0, data: wf }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), data: null, errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST workflow] error:", error);
    return NextResponse.json({ code: 500, data: null, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}