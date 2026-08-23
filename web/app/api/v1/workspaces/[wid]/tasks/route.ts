import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.enum(["todo", "in_progress", "review", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assigneeId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> }
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  const tasks = await runWithWorkspace(wid, (tx) =>
    tx.task.findMany({
      where: { workspaceId: wid },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        _count: { select: { comments: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
  );

  return NextResponse.json({ code: 200, data: tasks });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string }> }
) {
  const { wid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const validated = createTaskSchema.parse(body);

    const maxOrder = await prisma.task.aggregate({ where: { workspaceId: wid }, _max: { sortOrder: true } });

    const task = await runWithWorkspace(wid, (tx) =>
      tx.task.create({
        data: {
          ...validated,
          workspaceId: wid,
          createdBy: ctx.payload.sub,
          sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        },
        include: { assignee: { select: { id: true, name: true, email: true } } },
      })
    );

    return NextResponse.json({ code: 201, data: task }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: 400, message: "Validation error", errors: error.errors }, { status: 400 });
    }
    console.error("Create task error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
