import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext, runWithWorkspace } from "@/lib/auth";
import { apiMsg } from "@/lib/api-messages";

/**
 * GET /v1/workspaces/{wid}/approvals/instances/{aid} — 审批详情
 * 含 operations 操作记录（按 createdAt 正序）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wid: string; aid: string }> },
) {
  const { wid, aid } = await params;
  const ctx = await getWorkspaceContext(req, wid);
  if (!ctx) return NextResponse.json({ code: 401, message: apiMsg(req, "unauthorized"), data: null }, { status: 401 });

  try {
    const instance = await runWithWorkspace(wid, (tx) =>
      tx.approvalInstance.findUnique({
        where: { id: aid },
        include: {
          applicant: { select: { id: true, name: true, email: true } },
          operations: {
            orderBy: [{ createdAt: "asc" }],
            include: {
              operator: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
    );

    if (!instance || instance.workspaceId !== wid) {
      return NextResponse.json(
        { code: 404, message: apiMsg(req, "approvalNotFound"), data: null },
        { status: 404 },
      );
    }

    return NextResponse.json({ code: 200, data: instance });
  } catch (error) {
    console.error("[GET approval-instance] error:", error);
    return NextResponse.json(
      { code: 500, data: null, message: apiMsg(req, "internalError") },
      { status: 500 },
    );
  }
}