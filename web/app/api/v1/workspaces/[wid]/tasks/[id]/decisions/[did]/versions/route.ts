import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContextV2, runWithWorkspace } from "@/lib/auth";
import { authFailure } from "@/lib/auth-response";
import { apiMsg } from "@/lib/api-messages";

/** GET /v1/workspaces/{wid}/tasks/{id}/decisions/{did}/versions — 某条决策的版本历史（版本倒序） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; id: string; did: string }> },
) {
  const { wid, id, did } = await params;
  const ctx = await getWorkspaceContextV2(req, wid);
  if (!ctx)
    // V2 契约上从不返回 null（见 lib/auth.ts 的 WorkspaceContextV2 文档：
    // "调用方遇到 null 应按 500 处理（fail-closed，不可当作 401 重试）"）。
    return NextResponse.json(
      { code: 500, message: apiMsg(req, "internalError"), data: null },
      { status: 500 },
    );
  if (!ctx.ok) return authFailure(ctx, req);

  try {
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
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "decisionNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: versions });
  } catch (error) {
    console.error("[GET decision versions] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}
