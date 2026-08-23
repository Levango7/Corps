import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

const updateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  sortOrder: z.number().optional(),
});

/** GET /v1/workspaces/{wid}/tasks/{id} — 任务详情（详情页首屏） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> }
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  const task = await runWithWorkspace(wid, (tx) =>
    tx.task.findFirst({
      where: { id, workspaceId: wid },
      include: {
        assignee: { select: { id: true, name: true, email: true, image: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    })
  );

  if (!task) return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });

  return NextResponse.json({ code: 200, data: task });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> }
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const validated = updateTaskSchema.parse(body);

    const task = await runWithWorkspace(wid, (tx) =>
      tx.task.update({
        where: { id },
        data: validated,
        include: { assignee: { select: { id: true, name: true, email: true } } },
      })
    );

    return NextResponse.json({ code: 200, data: task });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: 400, message: "Validation error", errors: error.errors }, { status: 400 });
    }
    console.error("Update task error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> }
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  await runWithWorkspace(wid, (tx) => tx.task.delete({ where: { id } }));

  return NextResponse.json({ code: 200, data: null });
}
