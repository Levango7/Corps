import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { apiMsg } from "@/lib/api-messages";

/** GET /v1/workspaces/{wid} — 工作区详情（设置页 / 顶栏读取） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });

  try {
    const ws = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workspace.findUnique({
          where: { id: wid },
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            seatLimit: true,
            createdAt: true,
            _count: { select: { members: true, tasks: true } },
          },
        }),
      ctx.payload.sub,
    );

    if (!ws)
      return NextResponse.json({ code: 404, message: apiMsg(req, "workspaceNotFound") }, { status: 404 });

    return NextResponse.json({
      code: 200,
      data: {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        plan: ws.plan,
        seatLimit: ws.seatLimit,
        memberCount: ws._count.members,
        taskCount: ws._count.tasks,
        createdAt: ws.createdAt,
        role: ctx.member.role,
      },
    });
  } catch (error) {
    console.error("[GET workspace] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}

const updateWorkspaceSchema = z.object({
  name: z.string().min(2).max(64).optional(),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/, "只能包含小写字母、数字和连字符")
    .optional(),
});

/** PATCH /v1/workspaces/{wid} — 改名 / 改 slug，仅 owner|admin */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized") }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json(
      { code: 403, message: apiMsg(req, "onlyOwnerOrAdminUpdateWorkspace") },
      { status: 403 },
    );
  }

  try {
    const validated = updateWorkspaceSchema.parse(await req.json());

    const ws = await runWithWorkspace(
      wid,
      (tx) =>
        tx.workspace.update({
          where: { id: wid },
          data: validated,
          select: { id: true, name: true, slug: true },
        }),
      ctx.payload.sub,
    );

    return NextResponse.json({ code: 200, data: ws });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? apiMsg(req, "validationFailed"), errors: error.issues, data: null },
        { status: 400 },
      );
    }
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ code: 409, message: apiMsg(req, "slugTaken") }, { status: 409 });
    }
    // P2025: 记录不存在（并发删除场景）→ 404
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "workspaceNotFound") },
        { status: 404 },
      );
    }
    console.error("Update workspace error:", error);
    return NextResponse.json({ code: 500, message: apiMsg(req, "internalError") }, { status: 500 });
  }
}
