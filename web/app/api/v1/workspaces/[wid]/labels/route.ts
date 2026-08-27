import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

/**
 * 标签 API · /api/v1/workspaces/{wid}/labels
 *
 * - GET：列出当前工作区所有标签
 * - POST：创建新标签（仅 owner/admin）
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const labels = await runWithWorkspace(
      wid,
      (tx) =>
        tx.label.findMany({
          where: { workspaceId: wid },
          orderBy: { createdAt: "asc" },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 200, data: labels });
  } catch (error) {
    console.error("[GET labels] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}

const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().max(50).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ wid: string }> }) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });
  if (!["owner", "admin"].includes(ctx.member.role)) {
    return NextResponse.json({ code: 403, message: "Only owner/admin can create labels" }, {
      status: 403,
    });
  }

  try {
    const validated = createLabelSchema.parse(await req.json());
    const label = await runWithWorkspace(
      wid,
      (tx) =>
        tx.label.create({
          data: {
            workspaceId: wid,
            name: validated.name,
            color: validated.color ?? "var(--muted)",
          },
        }),
      ctx.payload.sub,
    );
    return NextResponse.json({ code: 201, data: label }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: "Validation error", errors: error.errors },
        { status: 400 },
      );
    }
    // P2002：唯一约束冲突（同工作区标签名重复）
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ code: 409, message: "标签名已存在" }, { status: 409 });
    }
    console.error("[POST label] error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}