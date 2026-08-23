import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";

/** GET /v1/workspaces/{wid}/tasks/{id}/decisions/{did}/versions — 某条决策的版本历史（版本倒序） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; did: string }> },
) {
  const { wid, id, did } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: "Unauthorized" }, { status: 401 });

  const versions = await runWithWorkspace(wid, async (tx) => {
    // 先校验该决策确实属于此任务（防跨任务读取，URL 语义正确性）
    const decision = await tx.decision.findFirst({
      where: { id: did, taskId: id, workspaceId: wid },
      select: { id: true },
    });
    if (!decision) return null;

    return tx.decisionVersion.findMany({
      where: { decisionId: did, workspaceId: wid },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { version: "desc" },
    });
  });

  if (versions === null) {
    return NextResponse.json({ code: 404, message: "决策不存在" }, { status: 404 });
  }

  return NextResponse.json({ code: 200, data: versions });
}
