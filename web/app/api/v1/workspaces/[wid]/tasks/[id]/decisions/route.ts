import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { z } from "zod";

/** GET /v1/workspaces/{wid}/tasks/{id}/decisions — 决策记录（版本倒序，最新在前） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> }
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  const decisions = await runWithWorkspace(wid, (tx) =>
    tx.decision.findMany({
      where: { taskId: id, task: { workspaceId: wid } },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { version: "desc" },
    })
  );

  return NextResponse.json({ code: 200, data: decisions });
}

const createDecisionSchema = z.object({
  markdown: z.string().min(1).max(50000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string }> }
) {
  const { wid, id } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  try {
    const validated = createDecisionSchema.parse(await req.json());

    const decision = await runWithWorkspace(wid, async (tx) => {
      const task = await tx.task.findFirst({ where: { id, workspaceId: wid }, select: { id: true } });
      if (!task) return null;

      // 决策记录只追加不覆盖：版本号在事务内自增（AC-06 可追溯）
      const agg = await tx.decision.aggregate({ where: { taskId: id }, _max: { version: true } });

      return tx.decision.create({
        data: {
          taskId: id,
          markdown: validated.markdown,
          version: (agg._max.version ?? 0) + 1,
          authorId: ctx.payload.sub,
        },
        include: { author: { select: { id: true, name: true, email: true } } },
      });
    });

    if (!decision) return NextResponse.json({ code: 404, message: "任务不存在" }, { status: 404 });

    return NextResponse.json({ code: 201, data: decision }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { code: 400, message: error.issues[0]?.message ?? "参数校验失败" },
        { status: 400 }
      );
    }
    console.error("Create decision error:", error);
    return NextResponse.json({ code: 500, message: "Internal server error" }, { status: 500 });
  }
}
