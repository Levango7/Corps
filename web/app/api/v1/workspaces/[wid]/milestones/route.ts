import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

/**
 * 里程碑 API · /api/v1/workspaces/{wid}/milestones
 *
 * - GET：列出当前工作区所有里程碑（按创建时间正序）
 * - POST：创建新里程碑（仅 owner/admin）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const milestones = await runWithWorkspace(
      wid,
      (tx) =>
        tx.milestone.findMany({
          where: { workspaceId: wid },
          orderBy: { createdAt: "asc" },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: milestones });
  } catch (error) {
    console.error("[GET milestones] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}

const createMilestoneSchema = z.object({
  name: z.string().min(1).max(100),
  dueDate: z.string().datetime().optional(),
  description: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json({ code: 403, message: "Only owner/admin can create milestones" }, {
      status: 403,
    });
  }

  try {
    const validated = createMilestoneSchema.parse(await req.json());
    const milestone = await runWithWorkspace(
      wid,
      (tx) =>
        tx.milestone.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
            description: validated.description,
          },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 201, data: milestone }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    console.error("[POST milestone] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}